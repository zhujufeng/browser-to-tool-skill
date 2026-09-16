#!/bin/sh
# macOS / Linux；只使用系统自带命令，不需要 Node、Python 或 Git。
set -eu
umask 077
fail() { printf '%s\n' "$*" >&2; exit 1; }
name='' desktop='' resume=''
while [ "$#" -gt 0 ]; do
  [ "$#" -ge 2 ] || fail '参数缺少值。使用 --name "任务名"，或 --resume "原任务绝对路径"。'
  case "$1" in
    --name) name=$2 ;;
    --desktop) desktop=$2 ;;
    --resume) resume=$2 ;;
    *) fail "未知参数：$1" ;;
  esac
  shift 2
done
if [ -n "$resume" ]; then
  [ -z "$name$desktop" ] || fail '--resume 不能与 --name 或 --desktop 同用。'
  case "$resume" in /*) ;; *) fail '续作目录必须是绝对路径。' ;; esac
  while [ "${resume%/}" != "$resume" ] && [ "$resume" != / ]; do resume=${resume%/}; done
  [ ! -L "$resume" ] && [ ! -L "$resume/工作记录.md" ] && [ ! -L "$resume/使用说明.md" ] && [ ! -L "$resume/代码" ] || fail '续作目录或关键文件是符号链接，请确认真实任务目录。'
  [ -f "$resume/工作记录.md" ] && [ -f "$resume/使用说明.md" ] && [ -d "$resume/代码" ] || fail '未找到完整任务目录；不会创建新目录或改写现有文件。'
  (cd -P "$resume" && pwd)
  exit 0
fi
[ -n "$name" ] || fail '请用 --name 提供简短任务名。'
name=$(printf '%s' "$name" | tr '/\\:*?"<>|' '-' | tr -d '\000-\037\177' | sed 's/^[.[:space:]]*//; s/[.[:space:]]*$//')
[ -n "$name" ] || fail '任务名不能为空或只有点、空白。'
[ "$(printf '%s' "$name" | wc -c | tr -d ' ')" -le 120 ] || fail '任务名太长，请用不超过约40个汉字的简短名称。'
if [ -z "$desktop" ]; then
  case "$(uname -s)" in
    Darwin) desktop=$(osascript -e 'POSIX path of (path to desktop folder)') || fail '无法读取系统桌面，请让用户指定保存位置。' ;;
    Linux)
      if [ -r /proc/sys/kernel/osrelease ] && grep -qi microsoft /proc/sys/kernel/osrelease; then
        fail '当前为WSL，不能假定Linux桌面是Windows桌面。请确认Windows桌面的挂载路径并显式传 --desktop。'
      fi
      command -v xdg-user-dir >/dev/null 2>&1 || fail '系统未提供桌面位置。请让用户指定已有保存目录，用 --desktop 传入。'
      desktop=$(xdg-user-dir DESKTOP) || fail '无法读取系统桌面位置。'
      [ "$desktop" != "${HOME:-}" ] || fail '系统未设置独立桌面。请让用户指定保存位置。'
      ;;
    *) fail '此脚本用于macOS/Linux；Windows请用workspace.ps1。' ;;
  esac
fi
case "$desktop" in /*) ;; *) fail '保存根目录必须是绝对路径。' ;; esac
[ -d "$desktop" ] || fail '保存根目录不存在；不会静默创建假桌面或回退当前目录。'
desktop=$(cd -P "$desktop" && pwd)
base="$(date +%F)_$name"
n=1
while :; do
  leaf=$base
  [ "$n" -eq 1 ] || leaf="${base}_$n"
  work="$desktop/$leaf"
  if mkdir -m 700 "$work" 2>/dev/null; then break; fi
  if [ -e "$work" ] || [ -L "$work" ]; then
    n=$((n + 1))
    [ "$n" -le 999 ] || fail '同名目录过多，请换一个任务名。'
  else
    fail "无法创建任务目录：${work}。请检查权限和空间；不会换位置或覆盖旧文件。"
  fi
done
# 创建后失败也保留已写内容；禁止用递归删除做失败回滚。
mkdir "$work/代码" || fail "创建代码目录失败，已有目录保留：$work"
printf '# 工作记录\n\n- 任务：%s\n- 创建：%s\n- 状态：准备中，尚未开始调查或验证。\n\n## 目标与授权范围\n\n待记录。\n\n## 调查、分析与决定\n\n按时间补充观察依据、结论与限制；不保存凭据或原始请求头。\n\n## 实际验证\n\n尚未执行。\n\n## 下一步\n\n检测环境并确认目标页面。\n' "$name" "$(date '+%F %T %z')" > "$work/工作记录.md" || fail "写入失败，已有目录保留：$work"
printf '# 使用说明\n\n工具尚未完成。交付时补齐首次准备、日常运行、输出位置、停止方式、已验证范围和限制。\n' > "$work/使用说明.md" || fail "写入失败，已有目录保留：$work"
printf '%s\n' "$work"
