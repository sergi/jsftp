# Foolproof way to always have ROOT_DIR refer to this very folder
ROOT_DIR:=$(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))

build-pureftpd:
	docker build --rm -t pure-ftp-demo $(ROOT_DIR)/pureftpd

test-pureftpd: kill-pureftpd
	docker run -d --name pureftpd_server -p 21:21 -p 30000-30009:30000-30009 -e "PUBLICHOST=localhost" -e "ADDED_FLAGS=-d -d" pure-ftp-demo
	docker exec -it pureftpd_server sh -c "(echo test; echo test) | pure-pw useradd bob -f /etc/pure-ftpd/passwd/pureftpd.passwd -m -u ftpuser -d /home/ftpusers/bob"
	npm run run-mocha

kill-pureftpd:
	-docker kill pureftpd_server
	-docker rm pureftpd_server

.PHONY: build-pureftpd test-pureftpd kill-pureftpd
