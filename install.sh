#!/bin/bash

sudo apt-get update
sudo apt-get install nodejs
sudo apt-get install npm
sudo ln -s `which nodejs` /usr/bin/node

npm install

