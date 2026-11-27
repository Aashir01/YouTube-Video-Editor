#!/bin/sh
# Double-click to start Cutroom on a Mac. It opens in your browser; close this window to stop it.
# (The first time, macOS may ask you to confirm: right-click the file, choose Open, then Open.)
cd "$(dirname "$0")" && exec ./cutroom.sh "$@"
