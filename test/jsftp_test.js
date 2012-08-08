#!/usr/bin/env node
/*
 * @package jsftp
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

"use strict";

var assert = require("assert");
var Fs = require("fs");
var exec = require('child_process').spawn;
var Ftp = require("../jsftp");
var Path = require("path");

// Write down your system credentials. This test suite will use OSX internal
// FTP server. If you want to test against a remote server, simply change the
// `host` and `port` properties as well.
var FTPCredentials = {
    host: "localhost",
    user: "user",
    port: 3334,
    pass: "12345"
};

var CWD = process.cwd() + "/test";
var remoteCWD = "test/test_c9";
var daemon;
exec('mkdir', [__dirname + "/" + remoteCWD]);

module.exports = {
    timeout: 10000,

    setUp: function(next) {
        if (FTPCredentials.host === "localhost") {
            try {
                daemon = exec('python', ['test/basic_ftpd.py']);
            }
            catch(e) {
                console.log(
                    "There was a problem trying to start the FTP service." +
                    " . This could be because you don't have enough permissions" +
                    "to run the FTP service on the given port.\n\n" + e
                );
            }
        }

        var self = this;
        setTimeout(function() {
            self.ftp = new Ftp(FTPCredentials);
            next();
        }, 200);
    },

    tearDown: function(next) {
        if (daemon)
            daemon.kill();

        var self = this;
        setTimeout(function() {
            self.ftp.destroy();
            self.ftp = null;
            next();
        }, 200);
    },
    "test features command": function(next) {
        var ftp = this.ftp;

        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            assert.ok(Array.isArray(ftp.features));

            if (ftp.features.length) {
                var feat = ftp.features[0];
                assert.ok(ftp.hasFeat(feat));
            }
            next();
        });
    },

    "test initialize": function(next) {
        var ftp = this.ftp;

        assert.equal(ftp.options, FTPCredentials);
        assert.equal(ftp.host, FTPCredentials.host);
        assert.equal(ftp.port, FTPCredentials.port);
        assert.equal(ftp.onError, null);
        assert.equal(ftp.onTimeout, null);
        assert.equal(ftp.onConnect, null);

        next();
    },

    "test print working directory": function(next) {
        var ftp = this.ftp;
        ftp.raw.pwd(function(err, res) {
            if (err) throw err;

            var code = parseInt(res.code, 10);
            assert.ok(code === 257, "PWD command was not successful");

            ftp.raw.quit(function(err, res) {
                if (err) throw err;

                next();
            });
        });
    },
    "test current working directory": function(next) {
        var ftp = this.ftp;
        ftp.raw.cwd(remoteCWD, function(err, res) {
            assert.ok(!err, err);

            var code = parseInt(res.code, 10);
            assert.ok(code === 200 || code === 250, "CWD command was not successful");

            ftp.raw.pwd(function(err, res) {
                if (err) throw err;

                var code = parseInt(res.code, 10);
                assert.ok(code === 257, "PWD command was not successful");
                assert.ok(res.text.indexOf(remoteCWD), "Unexpected CWD");
            });

            ftp.raw.cwd("/unexistentDir/", function(err, res) {
                  if (err)
                      assert.ok(err);
                  else {
                    code = parseInt(res.code, 10);
                    assert.ok(code === 550, "A (wrong) CWD command was successful. It should have failed");
                  }
                next();
            });
        });
    },
    "test passive listing of current directory": function(next) {
        this.ftp.list(remoteCWD, function(err, res){
                assert.ok(!err, err);
                next();
            });
    },

    "test ftp node stat": function(next) {
        var ftp = this.ftp;
            ftp.raw.pwd(function(err, res) {
                var parent = /.*"(.*)".*/.exec(res.text)[1];
                var path = Path.resolve(parent + "/" + remoteCWD);
                ftp.raw.stat(path, function(err, res) {
                    assert.ok(!err, res);
                    assert.ok(res);

                    assert.ok(res.code === 211 || res.code === 212 || res.code === 213);
                    next();
                });
            });
    },

    "test create and delete a directory": function(next) {
        var self = this;

        var newDir = remoteCWD + "/ftp_test_dir";
        var ftp = this.ftp;
        ftp.raw.mkd(newDir, function(err, res) {
            assert.ok(!err);
        assert.equal(res.code, 257);

            ftp.raw.rmd(newDir, function(err, res) {
                assert.ok(!err);
                next();
            });
        });
    },

    "test create and delete a directory containing a space": function(next) {
        var self = this;

        var newDir = remoteCWD + "/ftp test dür";
        var ftp = this.ftp;
        ftp.raw.mkd(newDir, function(err, res) {
            assert.ok(!err);
            assert.equal(res.code, 257);

            ftp.raw.rmd(newDir, function(err, res) {
                assert.ok(!err);
                next();
            });
        });
    },

    "test create and delete a file": function(next) {
        var self = this;

        var filePath = remoteCWD + "/file_ftp_test.txt";
        var ftp = this.ftp;
        Fs.readFile(CWD + "/jsftp_test.js", "binary", function(err, data) {
            var buffer = new Buffer(data, "binary");
            ftp.put(filePath, buffer, function(err, res) {
                assert.ok(!err, err);

                ftp.ls(filePath, function(err, res) {
                    assert.ok(!err);
                    assert.equal(buffer.length, Fs.statSync(CWD + "/jsftp_test.js").size);

                    ftp.raw.dele(filePath, function(err, data) {
                        assert.ok(!err);

                        next();
                    });
                });
            });
        });
    },

    "test rename a file": function(next) {
        var self = this;

        var from = remoteCWD + "/file_ftp_test.txt";
        var to = remoteCWD + "/file_ftp_test_renamed.txt";
        var ftp = this.ftp;
            Fs.readFile(CWD + "/jsftp_test.js", "binary", function(err, data) {
                assert.ok(!err, err);
                var buffer = new Buffer(data, "binary");
                ftp.put(from, buffer, function(err, res) {
                    assert.ok(!err, err);

                    ftp.rename(from, to, function(err, res) {
                        ftp.ls(to, function(err, res) {
                            assert.ok(!err);

                            assert.equal(buffer.length, Fs.statSync(CWD + "/jsftp_test.js").size);

                            ftp.raw.dele(to, function(err, data) {
                                assert.ok(!err);
                                next();
                            });
                        });
                    });
                });
            });
    },

    "test get a file": function(next) {
        var ftp = this.ftp;
        var fileName = "jsftp_test.js";
        var localPath = CWD + "/" + fileName;
        var remotePath = remoteCWD + "/" + fileName + ".test";

        Fs.readFile(localPath, "binary", function(err, data) {
            assert.ok(!err, err);
            var buffer = new Buffer(data, "binary");
            ftp.put(remotePath, buffer, function(err, res) {
                assert.ok(!err, err);
                ftp.get(remotePath, function(err, data) {
                    assert.ok(!err, err);

                    assert.equal(buffer.length, data.length);
                    ftp.raw.dele(remotePath, function(err, data) {
                        assert.ok(!err);
                        next();
                    });
                });
            });
        });
    },

    "test get two files synchronously": function(next) {
        var ftp = this.ftp;
        var filePath = remoteCWD + "/testfile.txt";
        var counter = 0;

        ftp.put(filePath, new Buffer("test"), handler);
        ftp.get(filePath, function(err, data) {
            assert.ok(!err, err);
            assert.ok(data);
        });

        ftp.put(filePath, new Buffer("test"), handler);
        ftp.get(filePath, function(err, data) {
            assert.ok(!err, err);
            assert.ok(data);
            assert.equal(counter, 2);
            next();
        });

        function handler() { counter++;};
    },

    "test get fileList array": function(next) {
        var ftp = this.ftp;
        var file1 = "testfile.txt";

            ftp.raw.pwd(function(err, res) {
                var parent, pathDir, path;
                if (remoteCWD.charAt(0) !== "/") {
                    parent = /.*"(.*)".*/.exec(res.text)[1];
                    pathDir = Path.resolve(parent + "/" + remoteCWD);
                    path = Path.resolve(pathDir + "/" + file1);
                }
                else {
                    pathDir = remoteCWD;
                    path = Path.resolve(remoteCWD + "/" + file1);
                }

                ftp.put(path, new Buffer("test"), function(err, res) {
                    assert.ok(!err);

                    ftp.raw.cwd(pathDir, function(err, res) {
                        ftp.ls(".", function(err, res) {
                            assert.ok(!err);

                            assert.ok(Array.isArray(res));

                            var fileNames = res.map(function(file) {
                                return file ? file.name : null;
                            });

                            assert.ok(fileNames.indexOf(file1) > -1);

                            next();
                        });
                    });
                });
            });
    },
    "test multiple concurrent pasvs": function(next) {
        var ftp = this.ftp;
        var file1 = "testfile1.txt";
        var file2 = "testfile2.txt";
        var file3 = "testfile3.txt";

        ftp.raw.pwd(function(err, res) {
            var parent, pathDir, path1, path2, path3;
            if (remoteCWD.charAt(0) !== "/") {
                parent = /.*"(.*)".*/.exec(res.text)[1];
                pathDir = Path.resolve(parent + "/" + remoteCWD);
                path1 = Path.resolve(pathDir + "/" + file1);
                path2 = Path.resolve(pathDir + "/" + file2);
                path3 = Path.resolve(pathDir + "/" + file3);
            }
            else {
                pathDir = remoteCWD;
                path1 = Path.resolve(remoteCWD + "/" + file1);
                path2 = Path.resolve(remoteCWD + "/" + file2);
                path3 = Path.resolve(remoteCWD + "/" + file3);
            }

            ftp.put(path1, new Buffer("test"), handler);
            ftp.put(path2, new Buffer("test"), handler);
            ftp.put(path3, new Buffer("test"), handler);

            var count = 0;
            function handler(err, res) {
            assert.ok(!err);
                if (++count == 3)
                    next();
            }
        });
    },
    "test stat and pasv calls in parallel without auth": function(next) {
        var ftp = this.ftp;

        ftp.raw.cwd("/", handler);
        ftp.raw.pwd(handler);

        ftp.ls("/", handler);
        ftp.ls("/", handler);
        ftp.ls("/", handler);
        ftp.ls("/", handler);

        var count = 0;
        function handler(err, res) {
            assert.ok(!err);
            if (++count == 6)
                next();
        }
    },
    "test reconnect": function(next) {
        var ftp = this.ftp;
        ftp.raw.pwd(function(err, res) {

            if (err) throw err;

            var code = parseInt(res.code, 10);
            assert.ok(code === 257, "PWD command was not successful");

            ftp.socket.end();
            ftp.raw.quit(function(err, res) {
                if (err) throw err;

                next();
            });
        });
    }
};

!module.parent && require("asyncjs").test.testcase(module.exports, "FTP").exec();

