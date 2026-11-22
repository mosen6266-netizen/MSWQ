#!/usr/bin/env python3
"""MSWQ safe restore of a complete migration ZIP into *new, empty* Cloudflare resources.

Requires Python 3.10+ and boto3 (pip install boto3).
This script NEVER deletes existing data, creates an admin credential, or changes
the source account. Pass credentials using environment variables, not CLI flags.
"""
import argparse
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BASE = "https://api.cloudflare.com/client/v4"


def need_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit("Missing environment variable: " + name)
    return value


def api(method, account_id, endpoint, body=None, binary=None):
    token = need_env("CLOUDFLARE_API_TOKEN")
    url = BASE + "/accounts/" + urllib.parse.quote(account_id, safe="") + endpoint
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif binary is not None:
        data = binary
        headers["Content-Type"] = "application/octet-stream"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            response_body = response.read()
        result = json.loads(response_body)
    except urllib.error.HTTPError as exc:
        message = exc.read(1500).decode("utf-8", "replace")
        raise RuntimeError("Cloudflare API HTTP " + str(exc.code) + " on " + endpoint + ": " + message) from exc
    if not result.get("success", False):
        raise RuntimeError("Cloudflare API error on " + endpoint + ": " + json.dumps(result.get("errors", []), ensure_ascii=False))
    return result


def d1_query(account, database_id, sql, params=None):
    endpoint = "/d1/database/" + urllib.parse.quote(database_id, safe="") + "/query"
    payload = {"sql": sql}
    if params is not None:
        payload["params"] = params
    result = api("POST", account, endpoint, payload)
    sub = result.get("result", [])
    if isinstance(sub, list) and sub and not sub[0].get("success", True):
        raise RuntimeError("D1 SQL failed: " + str(sub[0]))
    return sub[0].get("results", []) if isinstance(sub, list) and sub else []


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def enforce_empty_targets(account, main_db, docx_db, kv_id, s3, bucket):
    for name, dbid in [("main D1", main_db), ("DOCX D1", docx_db)]:
        rows = d1_query(account, dbid, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV'")
        if rows:
            raise RuntimeError(name + " already contains tables. Refusing to overwrite: " + str([row["name"] for row in rows]))
    kv_path = "/storage/kv/namespaces/" + urllib.parse.quote(kv_id, safe="") + "/keys?limit=1"
    if api("GET", account, kv_path).get("result"):
        raise RuntimeError("Destination DOCX KV is not empty. Refusing to overwrite.")
    if s3.list_objects_v2(Bucket=bucket, MaxKeys=1).get("KeyCount", 0):
        raise RuntimeError("Destination R2 bucket is not empty. Refusing to overwrite.")


def restore_d1(archive, account, dbid, folder):
    schema = json.loads(archive.read("d1/" + folder + "/schema.json"))
    tables = [x for x in schema if x.get("type") == "table"]
    others = [x for x in schema if x.get("type") != "table"]
    for record in tables:
        d1_query(account, dbid, record["sql"])
    total = 0
    for table in tables:
        name = table["name"]
        filename = "d1/" + folder + "/rows/" + urllib.parse.quote(name, safe="") + ".jsonl"
        if filename not in archive.namelist():
            raise RuntimeError("Missing D1 rows file: " + filename)
        with archive.open(filename) as stream:
            for line in stream:
                if not line.strip():
                    continue
                row = json.loads(line)
                columns = list(row)
                placeholders, parameters = [], []
                for col in columns:
                    value = row[col]
                    if isinstance(value, dict) and "__mswq_blob" in value:
                        placeholders.append("X'" + bytes(value["__mswq_blob"]).hex() + "'")
                    else:
                        placeholders.append("?")
                        parameters.append(value)
                statement = ("INSERT INTO " + ident(name) + " (" + ",".join(map(ident, columns)) + ") VALUES (" + ",".join(placeholders) + ")")
                d1_query(account, dbid, statement, parameters)
                total += 1
        count = d1_query(account, dbid, "SELECT COUNT(*) AS n FROM " + ident(name))[0]["n"]
        print("  D1", folder, name, str(count) + " rows", flush=True)
    for record in others:
        d1_query(account, dbid, record["sql"])
    return total


def restore_kv(archive, account, namespace):
    items = json.loads(archive.read("kv/index.json"))
    route = "/storage/kv/namespaces/" + urllib.parse.quote(namespace, safe="") + "/bulk"
    batch = []
    for item in items:
        key = item["name"]
        payload = {"key": key, "value": base64.b64encode(archive.read(item["zipPath"])).decode("ascii"), "base64": True}
        if item.get("metadata") is not None:
            payload["metadata"] = item["metadata"]
        if item.get("expiration"):
            payload["expiration"] = item["expiration"]
        batch.append(payload)
        if len(batch) >= 5:
            api("PUT", account, route, batch)
            batch = []
    if batch:
        api("PUT", account, route, batch)
    print("  KV", len(items), "raw values uploaded", flush=True)
    return len(items)


def restore_r2(archive, s3, bucket):
    from boto3.s3.transfer import TransferConfig

    config = TransferConfig(multipart_threshold=8 * 1024 * 1024, multipart_chunksize=8 * 1024 * 1024, max_concurrency=3)
    files = json.loads(archive.read("r2/index.json"))
    length = 0
    for index, item in enumerate(files, 1):
        extra = {"Metadata": {str(k): str(v) for k, v in (item.get("customMetadata") or {}).items()}}
        metadata = item.get("httpMetadata") or {}
        for key, target in [
            ("contentType", "ContentType"), ("cacheControl", "CacheControl"),
            ("contentDisposition", "ContentDisposition"), ("contentEncoding", "ContentEncoding"),
            ("contentLanguage", "ContentLanguage")
        ]:
            if metadata.get(key):
                extra[target] = metadata[key]
        with archive.open(item["zipPath"]) as content:
            s3.upload_fileobj(content, bucket, item["key"], ExtraArgs=extra, Config=config)
        uploaded = s3.head_object(Bucket=bucket, Key=item["key"])
        if uploaded["ContentLength"] != item["size"]:
            raise RuntimeError("R2 byte size mismatch for " + item["key"])
        expected_meta = {str(k).lower(): str(v) for k, v in (item.get("customMetadata") or {}).items()}
        actual_meta = {str(k).lower(): str(v) for k, v in uploaded.get("Metadata", {}).items()}
        for key, value in expected_meta.items():
            if actual_meta.get(key) != value:
                raise RuntimeError("R2 custom metadata mismatch for " + item["key"] + " field " + key)
        length += item["size"]
        if index % 10 == 0 or index == len(files):
            print("  R2", index, "/", len(files), "objects verified", flush=True)
    return len(files), length


def main():
    parser = argparse.ArgumentParser(description="Restore MSWQ migration ZIP to new EMPTY Cloudflare D1, R2, KV resources.")
    parser.add_argument("backup_zip")
    parser.add_argument("--main-db-id", required=True)
    parser.add_argument("--docx-db-id", required=True)
    parser.add_argument("--kv-id", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--execute", action="store_true", help="Required to write to destination resources")
    args = parser.parse_args()
    with zipfile.ZipFile(args.backup_zip) as archive:
        broken = archive.testzip()
        if broken:
            raise SystemExit("Invalid ZIP CRC in " + broken)
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("format") != "mswq-full-migration-v1":
            raise SystemExit("Unsupported archive format")
        print("MSWQ backup", manifest.get("createdAt"), json.dumps(manifest["content"], ensure_ascii=False))
        if not args.execute:
            print("Inspection completed: no data changed. Add --execute after provisioning empty resources.")
            return
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            raise SystemExit("Install R2 library first: python -m pip install boto3") from exc
        account = need_env("CLOUDFLARE_ACCOUNT_ID")
        access_key = need_env("R2_ACCESS_KEY_ID")
        secret = need_env("R2_SECRET_ACCESS_KEY")
        s3 = boto3.client(
            "s3",
            endpoint_url="https://" + account + ".r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret,
            region_name="auto",
            config=Config(signature_version="s3v4"),
        )
        enforce_empty_targets(account, args.main_db_id, args.docx_db_id, args.kv_id, s3, args.bucket)
        print("Target D1, R2, KV verified empty; starting restore.")
        main_rows = restore_d1(archive, account, args.main_db_id, "main")
        docx_rows = restore_d1(archive, account, args.docx_db_id, "docx")
        values = restore_kv(archive, account, args.kv_id)
        objects, bytes_restored = restore_r2(archive, s3, args.bucket)
        expected = manifest["content"]
        if values != expected["kvKeys"] or objects != expected["r2Objects"] or bytes_restored != expected["r2Bytes"]:
            raise RuntimeError("Backup manifest size/count mismatch")
        print("RESTORE COMPLETE:", main_rows, "main D1 rows,", docx_rows, "DOCX D1 rows,", values, "KV values,", objects, "R2 objects.")
        print("Next: compile and deploy both Workers, bind resources, set fresh ADMIN_PASSWORD and ADMIN_TOTP_SECRET.")


if __name__ == "__main__":
    main()
