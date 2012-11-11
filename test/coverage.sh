export JSFTP_COV=1 && rm -rf lib-cov && jscoverage lib lib-cov && mocha -R html-cov > coverage.html && unset JSFTP_COV
