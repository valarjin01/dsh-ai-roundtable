#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 dsh-ai-roundtable 装进 DSH 的 desktop profile。

做四件事（幂等，可重复运行）：
  1. profile/package.json：加 link:<本目录> 依赖 + 追加到 dsh.profile.bundles
  2. profile/node_modules/dsh-ai-roundtable：指向本目录的符号链接
  3. profile/cordis.patch.yml：追加一段配置（带 >>>/<<< 标记，便于回滚）
  4. 备份原文件到 .roundtable-backup/<时间戳>/

用法：python3 scripts/install-profile.py [--dry-run]
"""

import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent.parent
PROFILE = Path.home() / ".dsh" / "profiles" / "desktop"
PKG_NAME = "dsh-ai-roundtable"
START = "# >>> dsh-ai-roundtable"
END = "# <<< dsh-ai-roundtable"

CONFIG_BLOCK = f"""{START}
# 多模型圆桌。三个席位都走 OpenAI 兼容的 /chat/completions。
# apiKey 留空 = 跳过该席位；至少要有两个配好 key 的席位才能开场。
# 填法二选一：直接写 apiKey，或设置 apiKeyEnv 指向环境变量名。
# 换网关只改 baseUrl（OpenRouter / 302.AI 等都兼容）。
- id: {PKG_NAME}
  name: {PKG_NAME}
  config:
    moderator: DeepSeek
    style: debate            # 辩论 / brainstorm / redteam / postmortem / socratic / decision
    maxRounds: 2
    maxWordsPerTurn: 300
    maxTokens: 800
    temperature: 0.8
    participants:
      - name: DeepSeek
        baseUrl: https://api.deepseek.com
        model: deepseek-chat
        apiKey: ''
        persona: 结构化拆解与收敛：把模糊争论拆成可验证的判断
      - name: 豆包
        baseUrl: https://ark.cn-beijing.volces.com/api/v3
        model: doubao-seed-2-1-pro-260915
        thinking: 'off'
        apiKey: ''
        persona: 中文语境与落地细节：国内用户习惯、合规、执行阻力
{END}
"""


def backup(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = PROFILE / ".roundtable-backup" / stamp
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest / path.name)
    return dest


def main() -> int:
    dry = "--dry-run" in sys.argv

    if not PROFILE.is_dir():
        print(f"找不到 profile：{PROFILE}")
        return 1
    if not PLUGIN_DIR.joinpath("package.json").is_file():
        print(f"插件目录不完整：{PLUGIN_DIR}")
        return 1

    pkg_path = PROFILE / "package.json"
    patch_path = PROFILE / "cordis.patch.yml"

    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    deps = pkg.setdefault("dependencies", {})
    bundles = pkg.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])

    spec = f"link:{PLUGIN_DIR}"
    changes = []

    if deps.get(PKG_NAME) != spec:
        changes.append(f"dependencies[{PKG_NAME}] = {spec!r}（原 {deps.get(PKG_NAME)!r}）")
        deps[PKG_NAME] = spec

    if PKG_NAME not in bundles:
        changes.append(f"bundles 追加 {PKG_NAME}")
        bundles.append(PKG_NAME)

    patch_text = patch_path.read_text(encoding="utf-8") if patch_path.exists() else ""
    need_patch = START not in patch_text
    if need_patch:
        changes.append("cordis.patch.yml 追加配置块")

    link = PROFILE / "node_modules" / PKG_NAME
    if not link.is_symlink() or link.resolve() != PLUGIN_DIR:
        changes.append(f"符号链接 node_modules/{PKG_NAME} -> {PLUGIN_DIR}")

    if not changes:
        print("已经是安装状态，无需改动。")
        return 0

    print("将执行：")
    for c in changes:
        print("  -", c)
    if dry:
        print("\n(--dry-run，未写入)")
        return 0

    dest = backup(pkg_path)
    if patch_path.exists():
        shutil.copy2(patch_path, dest / patch_path.name)
    print(f"\n已备份到 {dest}")

    pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if need_patch:
        base = patch_text.rstrip() + "\n\n" if patch_text.strip() else ""
        patch_path.write_text(base + CONFIG_BLOCK, encoding="utf-8")

    (PROFILE / "node_modules").mkdir(parents=True, exist_ok=True)
    if link.is_symlink() or link.exists():
        link.unlink() if link.is_symlink() else shutil.rmtree(link)
    os.symlink(PLUGIN_DIR, link, target_is_directory=True)

    json.loads(pkg_path.read_text(encoding="utf-8"))  # 自检
    print("安装完成。重启 DeepSeek Harness 后生效。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
