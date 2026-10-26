#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 desktop profile 卸载 dsh-plugin-roundtable（install-profile.py 的逆操作）。

做四件事：
  1. package.json：删依赖项 + 从 dsh.profile.bundles 移除
  2. 删符号链接 node_modules/dsh-plugin-roundtable
  3. cordis.patch.yml：删掉 >>> / <<< 之间的配置块
  4. 不删 .roundtable-backup/，留作证据

用法：python3 scripts/uninstall-profile.py [--dry-run]
"""

import json
import shutil
import sys
from pathlib import Path

PROFILE = Path.home() / ".dsh" / "profiles" / "desktop"
PKG_NAME = "dsh-plugin-roundtable"
START = "# >>> dsh-plugin-roundtable"
END = "# <<< dsh-plugin-roundtable"


def strip_block(text: str) -> str:
    lines = text.splitlines(keepends=True)
    out, skipping = [], False
    for line in lines:
        if line.startswith(START):
            skipping = True
            continue
        if skipping:
            if line.startswith(END):
                skipping = False
            continue
        out.append(line)
    return "".join(out).rstrip() + "\n"


def main() -> int:
    dry = "--dry-run" in sys.argv
    pkg_path = PROFILE / "package.json"
    patch_path = PROFILE / "cordis.patch.yml"
    link = PROFILE / "node_modules" / PKG_NAME

    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    deps = pkg.get("dependencies", {})
    bundles = pkg.get("dsh", {}).get("profile", {}).get("bundles", [])

    changes = []
    if PKG_NAME in deps:
        changes.append(f"删除依赖 {PKG_NAME}")
    if PKG_NAME in bundles:
        changes.append(f"从 bundles 移除 {PKG_NAME}")
    if patch_path.exists() and START in patch_path.read_text(encoding="utf-8"):
        changes.append("删除 cordis.patch.yml 配置块")
    if link.is_symlink():
        changes.append(f"删除符号链接 {link}")

    if not changes:
        print("没有需要清理的内容，已是干净状态。")
        return 0

    print("将执行：")
    for c in changes:
        print("  -", c)
    if dry:
        print("\n(--dry-run，未写入)")
        return 0

    deps.pop(PKG_NAME, None)
    while PKG_NAME in bundles:
        bundles.remove(PKG_NAME)
    pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if patch_path.exists():
        patch_path.write_text(strip_block(patch_path.read_text(encoding="utf-8")), encoding="utf-8")

    if link.is_symlink():
        link.unlink()
    elif link.exists():
        shutil.rmtree(link)

    print("卸载完成。重启 DeepSeek Harness 后生效。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
