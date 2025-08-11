set -e
if [ -n "$GH_TOKEN" ]; then
  rm -rf src/data
  git clone --depth=1 "https://${GH_TOKEN}@github.com/vsme/obsidian-blog-data.git" src/data
else
  echo "GH_TOKEN missing"; exit 1
fi