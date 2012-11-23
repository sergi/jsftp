test:
	npm test

coverage:
	-jscoverage --no-highlight lib lib-cov
	-env VFS_FTP_COV=1 mocha -t 5000 -R html-cov > coverage.html
	rm -rf lib-cov

.PHONY: test
