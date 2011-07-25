/*
 * @package jsFTP
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var assert = require("assert");
var Fs = require("fs");
var exec = require('child_process').spawn;
var Ftp = require("./jsftp");

// Write down your system credentials. This test suite will use OSX internal
// FTP server. If you want to test against a remote server, simply change the
// `host` and `port` properties as well.
var FTPCredentials = {
    host: "localhost",
    user: "",
    port: 21,
    pass: ""
};

var CWD = process.cwd();
console.log("Current working directory is " + CWD + "\n");

// Execution ORDER: test.setUpSuite, setUp, testFn, tearDown, test.tearDownSuite
module.exports = {
    timeout: 10000,

    setUp: function(next) {
        try {
            exec('/bin/launchctl', ['load', '-w', '/System/Library/LaunchDaemons/ftp.plist']);
        } catch(e) {}

        var self = this;
        setTimeout(function() {
            self.ftp = new Ftp(FTPCredentials);
            next();
        }, 200);
    },

    tearDown: function(next) {
        try {
            exec('/bin/launchctl', ['unload', '-w', '/System/Library/LaunchDaemons/ftp.plist']);
        } catch (e) {}

        var self = this;
        next();
        setTimeout(function() {
            self.ftp = null;
            next();
        }, 200);
    },

    "test print working directory": function(next) {
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            ftp.raw.pwd(function(err, res) {
                if (err) throw err;

                var code = parseInt(res.code, 10);
                assert.ok(code === 257, "PWD command was not successful");

                ftp.raw.quit(function(err, res) {
                    if (err) throw err;

                    next();
                });
            });
        });
    },
    "test current working directory": function(next) {
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            if (err) throw err;

            ftp.raw.cwd(CWD, function(err, res) {
                if (err) throw err;

                var code = parseInt(res.code, 10);
                assert.ok(code === 200 || code === 250, "CWD command was not successful");

                ftp.raw.pwd(function(err, res) {
                    if (err) throw err;

                    var code = parseInt(res.code, 10);
                    assert.ok(code === 257, "PWD command was not successful");
                    assert.ok(res.text.indexOf(CWD), "Unexpected CWD");
                });

                ftp.raw.cwd("/unexistentDir/", function(err, res) {
                    assert.ok(err);

                    code = parseInt(res.code, 10);
                    assert.ok(code === 550, "A (wrong) CWD command was successful. It should have failed");
                    next();
                });
            });
        });
    },
    "test passive listing of current directory": function(next) {
        var ftp = this.ftp;

        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(res) {
            ftp.list(CWD, function(err, res){
                next();
            });
        });
    },

    "test ftp node stat": function(next) {
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            ftp.raw.cwd(CWD, function(err, res) {
                ftp.raw.stat(CWD, function(err, res) {
                    assert.ok(!err);

                    assert.ok(res.code === 211);
                    next();
                });
            });
        });
    },

    "test create and delete a directory": function(next) {
        var self = this;

        var newDir = CWD + "/ftp_test_dir";
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            ftp.raw.mkd(newDir, function(err, res) {
                assert.ok(!err);
                assert.ok(res.code === 257);

                ftp.raw.rmd(newDir, function(err, res) {
                    assert.ok(!err);
                    next();
                });
            });
        });
    },

    "test create and delete a file": function(next) {
        var self = this;

        var filePath = CWD + "/file_ftp_test.txt";
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            Fs.readFile(CWD + "/jsftp_test.js", "binary", function(err, data) {
                var buffer = new Buffer(data, "binary");
                ftp.put(filePath, buffer, function(err, res) {
                    assert.ok(!err, err);

                    ftp.raw.stat(filePath, function(err, res) {
                        assert.ok(!err);

                        assert.equal(buffer.length, Fs.statSync(filePath).size);

                        ftp.raw.dele(filePath, function(err, data) {
                            assert.ok(!err);

                            next();
                        });
                    });
                });
            });
        });
    },

    "test get a file": function(next) {
        var self = this;

        var filePath = CWD + "/jsftp_test.js";
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            Fs.readFile(filePath, "binary", function(err, data) {
                var buffer = new Buffer(data, "binary");
                ftp.get(filePath, function(err, data) {
                    assert.ok(!err, err);

                    assert.equal(buffer.length, data.length);
                    next()
                });
            });
        });
    },
};

!module.parent && require("asyncjs").test.testcase(module.exports, "FTP").exec();
