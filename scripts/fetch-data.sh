set -e
if [ -n "$GH_TOKEN" ]; then
  rm -rf src/data
  # 从 .gitmodules 读取 URL 并转换为 HTTPS 格式
  REPO_URL=$(git config -f .gitmodules --get submodule.src/data.url)
  # 将 SSH 格式转换为 HTTPS 格式
  HTTPS_URL=$(echo "$REPO_URL" | sed 's|git@github.com:|https://github.com/|')
  git clone --depth=1 "https://${GH_TOKEN}@$(echo "$HTTPS_URL" | sed 's|https://||')" src/data
else
  echo "GH_TOKEN missing"; exit 1
fi