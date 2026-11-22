#!/usr/bin/env python3
"""One-command MSWQ restore from a GitHub Release on a brand-new Cloudflare account.

Run in an authorized cloud computer, NOT in a public web page.
Needs Python 3.10+, boto3, Node.js 20+, npx/wrangler and permissions provided
by the owner. Credentials are read from environment variables and never committed.
This tool does not use or modify the old Cloudflare account.
"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

CF_API = "https://api.cloudflare.com/client/v4"

def request_json(url, token=None, method="GET", payload=None):
    headers={"Accept":"application/vnd.github+json" if "api.github.com" in url else "application/json",
             "User-Agent":"MSWQ-Rebuild"}
    if token:
        headers["Authorization"]="Bearer "+token
    body=None
    if payload is not None:
        headers["Content-Type"]="application/json"
        body=json.dumps(payload).encode("utf-8")
    request=urllib.request.Request(url,method=method,headers=headers,data=body)
    with urllib.request.urlopen(request,timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))

def cf(account,path,method="GET",body=None):
    token=os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token: raise RuntimeError("CLOUDFLARE_API_TOKEN is required")
    url=CF_API+"/accounts/"+account+path
    result=request_json(url,token,method,body)
    if not result.get("success",False):
        raise RuntimeError("Cloudflare "+path+": "+str(result.get("errors")))
    return result["result"]

def release_zip(repo,tag,directory):
    owner,name=repo.split("/",1)
    if tag:
        url="https://api.github.com/repos/"+owner+"/"+name+"/releases/tags/"+urllib.parse.quote(tag,safe="")
    else:
        url="https://api.github.com/repos/"+owner+"/"+name+"/releases/latest"
    token=os.environ.get("GITHUB_TOKEN")
    release=request_json(url,token)
    assets=[a for a in release.get("assets",[]) if a.get("name","").startswith("MSWQ-complete-") and a.get("name","").lower().endswith(".zip")]
    if len(assets)!=1:
        raise RuntimeError("Expected exactly ONE MSWQ-complete-*.zip Release asset, got "+str(len(assets)))
    asset=assets[0]
    if asset.get("size",0)>=2*1024**3:
        raise RuntimeError("GitHub Release asset exceeds the 2 GiB limit")
    dest=directory/asset["name"]
    print("Downloading GitHub Release backup:",asset["name"],"bytes",asset.get("size"))
    headers={"User-Agent":"MSWQ-Rebuild"}
    if token:
        url=asset["url"]
        headers.update({"Authorization":"Bearer "+token,"Accept":"application/octet-stream"})
    else:
        url=asset["browser_download_url"]
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=180) as r, open(dest,"wb") as f:
        if r.headers.get("content-type","").startswith("application/json"):
            raise RuntimeError("GitHub returned JSON instead of the release ZIP; check asset permissions")
        shutil.copyfileobj(r,f,1024*1024)
    if dest.stat().st_size!=asset["size"]:
        raise RuntimeError("Release download size mismatch")
    with zipfile.ZipFile(dest) as z:
        bad=z.testzip()
        if bad: raise RuntimeError("Corrupted backup ZIP entry: "+bad)
        meta=json.loads(z.read("manifest.json"))
        if meta.get("format")!="mswq-full-migration-v1":
            raise RuntimeError("Unexpected backup format")
    return dest,meta,release,asset

def safe_extract(nested,dest):
    dest=dest.resolve()
    for info in nested.infolist():
        name=info.filename.replace("\\","/")
        if name.startswith("/") or ".." in name.split("/"):
            raise RuntimeError("Unsafe path in source ZIP: "+name)
        target=(dest/name).resolve()
        if not target.is_relative_to(dest):raise RuntimeError("Source ZIP path escapes workspace")
        if info.is_dir():target.mkdir(parents=True,exist_ok=True);continue
        target.parent.mkdir(parents=True,exist_ok=True)
        with nested.open(info) as src,open(target,"wb") as output:shutil.copyfileobj(src,output)

def empty_resources(account):
    suffix=uuid.uuid4().hex[:9]
    main_name="mswq-main-"+suffix
    docx_name="mswq-docx-"+suffix
    bucket="mswq-files-"+suffix
    kv_name="MSWQ_DOCX_KV_"+suffix
    main=cf(account,"/d1/database","POST",{"name":main_name})
    docx=cf(account,"/d1/database","POST",{"name":docx_name})
    kv=cf(account,"/storage/kv/namespaces","POST",{"title":kv_name})
    cf(account,"/r2/buckets","POST",{"name":bucket})
    return {
      "main_id":main.get("uuid") or main.get("id"),
      "docx_id":docx.get("uuid") or docx.get("id"),
      "kv_id":kv.get("id"),
      "main_name":main_name,"docx_name":docx_name,
      "kv_name":kv_name,"bucket":bucket
    }

def restore_archive(project,backup,account,res):
    spec=importlib.util.spec_from_file_location("mswq_restorer",project/"scripts/restore-mswq.py")
    if not spec or not spec.loader:raise RuntimeError("Restorer script missing")
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise RuntimeError("Install boto3: python -m pip install boto3") from exc
    access=os.environ.get("R2_ACCESS_KEY_ID")
    secret=os.environ.get("R2_SECRET_ACCESS_KEY")
    if not access or not secret:
        raise RuntimeError("New account R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required for exact R2 metadata restore")
    s3=boto3.client("s3",endpoint_url="https://"+account+".r2.cloudflarestorage.com",
                    aws_access_key_id=access,aws_secret_access_key=secret,
                    region_name="auto",config=Config(signature_version="s3v4"))
    with zipfile.ZipFile(backup) as z:
        mod.enforce_empty_targets(account,res["main_id"],res["docx_id"],res["kv_id"],s3,res["bucket"])
        print("Restoring main and DOCX D1...")
        main_rows=mod.restore_d1(z,account,res["main_id"],"main")
        docx_rows=mod.restore_d1(z,account,res["docx_id"],"docx")
        print("Restoring KV and R2 with original keys and metadata...")
        kv_count=mod.restore_kv(z,account,res["kv_id"])
        obj_count,bytes_restored=mod.restore_r2(z,s3,res["bucket"])
        manifest=json.loads(z.read("manifest.json"))["content"]
        if kv_count!=manifest["kvKeys"] or obj_count!=manifest["r2Objects"] or bytes_restored!=manifest["r2Bytes"]:
            raise RuntimeError("Restoration manifest count/byte mismatch")
    return dict(mainRows=main_rows,docxRows=docx_rows,kvKeys=kv_count,r2Objects=obj_count,r2Bytes=bytes_restored)

def write_configs(project,account,res,repo):
    try:
        subdomain=cf(account,"/workers/subdomain")["subdomain"]
    except Exception:
        # A fresh account may not have a workers.dev subdomain yet.
        subdomain="mswq-"+uuid.uuid4().hex[:12]
        cf(account,"/workers/subdomain","PUT",{"subdomain":subdomain})
    html_url="https://mswq-html."+subdomain+".workers.dev"
    main=json.loads((project/"wrangler.main.example.jsonc").read_text(encoding="utf-8"))
    main["name"]="mswq"
    main["d1_databases"][0].update(database_name=res["main_name"],database_id=res["main_id"])
    main["d1_databases"][1].update(database_name=res["docx_name"],database_id=res["docx_id"])
    main["kv_namespaces"][0]["id"]=res["kv_id"]
    main["r2_buckets"][0]["bucket_name"]=res["bucket"]
    main["vars"]["MSWQ_BACKUP_GITHUB_REPO"]=repo
    html=json.loads((project/"wrangler.html-host.example.jsonc").read_text(encoding="utf-8"))
    html["name"]="mswq-html"
    html["r2_buckets"][0]["bucket_name"]=res["bucket"]
    (project/"wrangler.jsonc").write_text(json.dumps(main,ensure_ascii=False,indent=2),encoding="utf-8")
    (project/"wrangler.html-host.jsonc").write_text(json.dumps(html,ensure_ascii=False,indent=2),encoding="utf-8")
    return html_url

def command(args,cwd,env=None,input_text=None):
    print("$"," ".join(str(a) for a in args),flush=True)
    subprocess.run(args,cwd=cwd,env=env,input=input_text,text=True,check=True)

def deploy(project,account,res,repo):
    html_url=write_configs(project,account,res,repo)
    env=os.environ.copy()
    env["MSWQ_HTML_ORIGIN"]=html_url
    command(["node","scripts/build-mswq.mjs"],project,env)
    snapshot=(project/"dist/mswq-source-snapshot.json").read_bytes()
    # This private R2 file is a restore source snapshot used by future exports.
    token=os.environ["CLOUDFLARE_API_TOKEN"]
    path=CF_API+"/accounts/"+account+"/r2/buckets/"+res["bucket"]+"/objects/mswq-private%2Fsource-snapshot-v1.json"
    req=urllib.request.Request(path,data=snapshot,method="PUT",headers={
      "Authorization":"Bearer "+token,"Content-Type":"application/json","User-Agent":"MSWQ-Rebuild"
    })
    with urllib.request.urlopen(req,timeout=120) as response:
        data=json.loads(response.read())
        if not data.get("success",False):raise RuntimeError("R2 source snapshot upload failed: "+str(data.get("errors")))
    command(["npx","--yes","wrangler","deploy","--config","wrangler.html-host.jsonc"],project,env)
    command(["npx","--yes","wrangler","deploy","--config","wrangler.jsonc"],project,env)
    return html_url,"https://mswq."+html_url.split("mswq-html.",1)[1]

def push_source_to_github(project,repo):
    """Commit non-secret application source to the new GitHub repository."""
    token=os.environ.get("GITHUB_TOKEN")
    if not token:
        print("GitHub source push deferred: have the new GPT use its connected GitHub app to commit the extracted project sources.")
        return False
    root="https://api.github.com/repos/"+repo+"/contents/"
    excluded={".env",".dev.vars","wrangler.jsonc","wrangler.html-host.jsonc"}
    count=0
    for path in sorted(project.rglob("*")):
        if not path.is_file():continue
        rel=path.relative_to(project).as_posix()
        if any(part in (".git","node_modules","dist",".wrangler") for part in path.relative_to(project).parts):
            continue
        if path.name in excluded or path.name.endswith(".zip") or path.name.endswith(".bak"):
            continue
        blob=path.read_bytes()
        if len(blob)>1000000:raise RuntimeError("GitHub source file too large: "+rel)
        url=root+urllib.parse.quote(rel,safe="/")
        current=None
        try:
            current=request_json(url,token)
        except urllib.error.HTTPError as e:
            if e.code!=404:raise
        data={"message":"Restore MSWQ source: "+rel,
              "content":base64.b64encode(blob).decode("ascii"),"branch":"main"}
        if current and current.get("sha"):data["sha"]=current["sha"]
        request_json(url,token,"PUT",data)
        count+=1
    print("Restored",count,"source files to",repo)
    return True


def setup_new_admin_secrets(project):
    """Provision fresh password/TOTP/session secrets; do NOT copy old credentials."""
    password=secrets.token_urlsafe(24)
    key=base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")
    signing=secrets.token_urlsafe(48)
    for name,value in (("ADMIN_PASSWORD",password),
                       ("ADMIN_TOTP_SECRET",key),
                       ("SESSION_SECRET",signing)):
        command(["npx","--yes","wrangler","secret","put",name,
                 "--config","wrangler.jsonc"],project,
                input_text=value+"\n")
    # Shown once in the console, not written to the source tree or GitHub.
    print("NEW ADMIN PASSWORD (save securely):",password,flush=True)
    print("NEW GOOGLE AUTHENTICATOR MANUAL KEY (Base32):",key,flush=True)
    print("Use SHA1 / 6 digits / 30 seconds. Never publish these values.",flush=True)
    return True


def main():
    parser=argparse.ArgumentParser(description="Recreate MSWQ in a NEW Cloudflare account from a single GitHub Release ZIP.")
    parser.add_argument("--repo",required=True,help="New GitHub repository, OWNER/REPO")
    parser.add_argument("--tag",default="mswq-migration",help="GitHub Release tag")
    parser.add_argument("--local-zip",help="Use a previously downloaded Release ZIP rather than downloading it again")
    parser.add_argument("--execute",action="store_true",help="Explicitly create Cloudflare resources and deploy")
    args=parser.parse_args()
    if args.repo.count("/")!=1:parser.error("Repository must be OWNER/REPO")
    if not args.execute:
        print("DRY RUN: add --execute after connecting to the NEW GitHub/Cloudflare accounts.")
        print("Requires environment: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.")
        print("For private GitHub repository also set GITHUB_TOKEN.")
        return
    account=os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    for name in ("CLOUDFLARE_API_TOKEN","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY"):
        if not os.environ.get(name):raise RuntimeError("Missing new-account credential "+name)
    if not account:raise RuntimeError("Missing CLOUDFLARE_ACCOUNT_ID")
    with tempfile.TemporaryDirectory(prefix="mswq-rebuild-") as work:
        directory=Path(work)
        if args.local_zip:
            archive=Path(args.local_zip).expanduser().resolve()
            if not archive.is_file():raise RuntimeError("Local ZIP does not exist")
            with zipfile.ZipFile(archive) as z:
                bad=z.testzip()
                if bad:raise RuntimeError("ZIP CRC check failed: "+bad)
                manifest=json.loads(z.read("manifest.json"))
                if manifest.get("format")!="mswq-full-migration-v1":raise RuntimeError("Invalid manifest")
            release={"html_url":"GitHub Release: "+args.repo+" / "+args.tag}
            asset={"id":None,"name":archive.name}
        else:
            archive,manifest,release,asset=release_zip(args.repo,args.tag,directory)
        project=directory/"project"
        with zipfile.ZipFile(archive) as z:
            with zipfile.ZipFile(z.open("sources/MSWQ-github.zip")) as sources:
                safe_extract(sources,project)
        for filename in ("src/worker.js","src/html-host.js","scripts/restore-mswq.py","scripts/build-mswq.mjs"):
            if not (project/filename).is_file():raise RuntimeError("Source file missing: "+filename)
        resource=empty_resources(account)
        print("New resources created:",json.dumps(resource))
        counts=restore_archive(project,archive,account,resource)
        html_url,main_url=deploy(project,account,resource,args.repo)
        setup_new_admin_secrets(project)
        pushed=push_source_to_github(project,args.repo)
        print(json.dumps({
          "status":"RESTORED_AND_DEPLOYED_NOT_YET_BROWSER_VERIFIED",
          "mainUrl":main_url,"htmlToolsUrl":html_url,
          "restoredCounts":counts,
          "sourcePushedToGitHub":pushed,
          "releaseAssetId":asset["id"],
          "releaseUrl":release.get("html_url"),
          "next":"New admin password and TOTP were generated above. Bind Google Authenticator, run end-to-end browser tests, THEN delete the GitHub Release backup asset."
        },indent=2,ensure_ascii=False))
        # Backup deletion intentionally NOT automatic: don't destroy the only
        # working copy before login, DOCX and HTML end-to-end verification.
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("REBUILD FAILED:",str(exc),file=sys.stderr)
        sys.exit(1)
