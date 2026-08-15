#!/bin/sh
echo "Downloading loot.json"
#URL="https://eggincdatacollection.azurewebsites.net/api/GetCarpetData"
#URL="https://eggincdatacollection.azurewebsites.net/api/GetCarpetDataTrimmed"
#URL="https://eggincdatacollection.azurewebsites.net/api/GetCarpetDataTrimmed?oldDropsOnly"
URL="https://eggincdatacollection.azurewebsites.net/api/GetCarpetDataTrimmed?newDropsOnly"
HTTP_CODE=$(curl -so loot_raw.json --write-out "%{http_code}" "${URL}")
echo "HTTP ${HTTP_CODE}"
if [ -s loot_raw.json ]; then
  echo 'updating loot.json'
  # jq instead of mv to get rid of evil windows newlines. Normalize into a temp file
  # first: a redirect truncates data/loot.json before jq ever sees the input, so an
  # invalid response would otherwise leave an empty file behind and delete the evidence.
  script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  tmp=$(mktemp "${script_dir}/data/loot.json.XXXXXX")
  if jq -r . loot_raw.json > "$tmp"; then
    mv "$tmp" "${script_dir}/data/loot.json"
    rm loot_raw.json
  else
    rm -f "$tmp"
    exit 1
  fi
fi
