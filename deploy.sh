#!/bin/bash
# Paleisti serveryje kaip root: bash deploy.sh
set -e
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
if ! swapon --show | grep -q .; then fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
docker compose up -d --build
echo "Paruošta. Atidarykite: https://$(head -1 Caddyfile | cut -d' ' -f1)"
