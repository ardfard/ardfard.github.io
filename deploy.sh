#!/usr/bin/env sh

rsync --checksum -ave "ssh -i $NGUBLAG_PEM_KEY" _site/* ubuntu@ngublag.com:ngublag.com
