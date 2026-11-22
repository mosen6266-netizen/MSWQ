#!/usr/bin/env python3
"""Remove only the temporary GitHub Release ZIP *after* full migration verification.

This does not delete GitHub source code, commits, Cloudflare resources or the
original site. It does not guarantee copies already downloaded elsewhere vanish.
"""
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def github(method, url):
    token=os.environ.get("GITHUB_TOKEN","")
    if not token:
        raise RuntimeError("New GitHub account GITHUB_TOKEN required for asset cleanup")
    headers={"Accept":"application/vnd.github+json","Authorization":"Bearer "+token,
             "User-Agent":"MSWQ-Verified-Migration-Cleanup"}
    req=urllib.request.Request(url,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=90) as response:
        return json.loads(response.read() or b"{}") if response.status != 204 else {}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--repo",required=True,help="New GitHub OWNER/REPO")
    parser.add_argument("--tag",default="mswq-migration")
    parser.add_argument("--verified",action="store_true",help="Confirm that the new site passed full end-to-end verification")
    args=parser.parse_args()
    if not args.verified:
        raise SystemExit("Refusing to delete the sole migration ZIP before full site verification. Add --verified only after verifying.")
    if args.repo.count("/")!=1:
        raise SystemExit("Invalid repository")
    url="https://api.github.com/repos/"+args.repo+"/releases/tags/"+urllib.parse.quote(args.tag,safe="")
    release=github("GET",url)
    assets=[x for x in release.get("assets",[]) if x.get("name","").startswith("MSWQ-complete-") and x.get("name","").lower().endswith(".zip")]
    if len(assets)!=1:
        raise RuntimeError("Expected exactly one MSWQ migration ZIP, found "+str(len(assets)))
    item=assets[0]
    print("Deleting temporary GitHub Release ZIP:",item["name"])
    github("DELETE","https://api.github.com/repos/"+args.repo+"/releases/assets/"+str(item["id"]))
    checked=github("GET",url)
    if any(x.get("id")==item["id"] for x in checked.get("assets",[])):
        raise RuntimeError("GitHub Release ZIP still present after delete")
    print("Verified: temporary GitHub Release ZIP removed; repository source code untouched.")

if __name__=="__main__":
    main()
