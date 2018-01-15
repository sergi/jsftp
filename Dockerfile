FROM node:alpine AS build-env-node
ENV DEBUG=jsftp
WORKDIR /jsftp
COPY package.json .
RUN npm install
COPY ./lib/jsftp.js ./index.js
COPY ./test/ ./test/
