#!/bin/bash
# 把源码根目录下的 cloudfunctions 同步到小程序编译产物目录，
# 并写入 cloudfunctionRoot，使微信开发者工具出现「上传并部署」右键菜单。
# 每次执行 npm run build:mp-weixin 之后都要跑一次本脚本。
set -e
cd "$(dirname "$0")"

SRC="cloudfunctions"
DST="dist/build/mp-weixin"

if [ ! -d "$DST" ]; then
  echo "错误：找不到 $DST，请先执行 npm run build:mp-weixin"
  exit 1
fi

rm -rf "$DST/$SRC"
cp -R "$SRC" "$DST/$SRC"
echo "已同步云函数到 $DST/$SRC"

# 写入 cloudfunctionRoot + packOptions.ignore（幂等）
# - cloudfunctionRoot：让开发者工具识别云函数目录，出现「上传并部署」右键菜单
# - packOptions.ignore：排除 cloudfunctions，不占主包 1.5M 体积、不参与代码质量扫描
CFG="$DST/project.config.json"
python3 - "$CFG" <<'PY'
import json, sys
p = sys.argv[1]
with open(p, encoding='utf-8') as f:
    cfg = json.load(f)

changed = False
if cfg.get('cloudfunctionRoot') != 'cloudfunctions/':
    out = {}
    for k, v in cfg.items():
        out[k] = v
        if k == 'projectname':
            out['cloudfunctionRoot'] = 'cloudfunctions/'
    if 'cloudfunctionRoot' not in out:
        out['cloudfunctionRoot'] = 'cloudfunctions/'
    cfg = out
    changed = True
    print('已写入 cloudfunctionRoot')

ig = cfg.setdefault('packOptions', {}).setdefault('ignore', [])
entry = {'type': 'folder', 'value': 'cloudfunctions'}
if entry not in ig:
    ig.append(entry)
    changed = True
    print('已写入 packOptions.ignore(cloudfunctions)')

if changed:
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
else:
    print('配置无需变更')
PY

echo "完成。请在微信开发者工具中：项目 -> 重新打开此项目（或重启工具）"
