#!/bin/zsh
cd "/Users/miles/Documents/GitHub/fedl" || exit 1
HOST=0.0.0.0 PORT=8090 node server/server.js
