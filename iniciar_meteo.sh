#!/bin/bash
cd /home/luis/Meteorologia_Diaria || exit 1
python3 servidor.py "$@"
