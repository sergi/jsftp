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
var Path = require("path");

// Write down your system credentials. This test suite will use OSX internal
// FTP server. If you want to test against a remote server, simply change the
// `host` and `port` properties as well.
var FTPCredentials = {
    host: "",
    user: "",
    port: 21,
    pass: ""
};

var CWD = process.cwd();
// Substitute "test_c9" by a real directory in your remote FTP server.
var remoteCWD = FTPCredentials.host === "localhost" ? CWD : "test_c9";
console.log("Current working directory is " + CWD + "\n");

// Execution ORDER: test.setUpSuite, setUp, testFn, tearDown, test.tearDownSuite
module.exports = {
    timeout: 10000,

    setUp: function(next) {
        if (FTPCredentials.host === "localhost") {
            try {
                exec('/bin/launchctl', ['load', '-w', '/System/Library/LaunchDaemons/ftp.plist']);
            }
            catch(e) {
                console.log(
                    "There was a problem trying to start the FTP service."
                    + " . This could be because you are not on OSX, or because "
                    + "you don't have enough permissions to run the FTP service"
                    + " on the given port.\n\n" + e
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
        if (FTPCredentials.host === "localhost") {
            try {
                exec('/bin/launchctl', ['unload', '-w', '/System/Library/LaunchDaemons/ftp.plist']);
            }
            catch (e) {
                console.log("The FTP service could not be stopped. Do you have enough permissions?");
            }
        }

        var self = this;
        next();
        setTimeout(function() {
            self.ftp.destroy();
            self.ftp = null;
            next();
        }, 200);
    },
    /*
    ">test features command": function(next) {
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            assert.ok(!err);

            assert.ok(Array.isArray(ftp.features));

            if (ftp.features.length) {
                var feat = ftp.features[0];
                assert.ok(ftp.hasFeat(feat));
            }
            next();
        });
    },
    */

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

            ftp.raw.cwd(remoteCWD, function(err, res) {
                if (err) throw err;

                var code = parseInt(res.code, 10);
                assert.ok(code === 200 || code === 250, "CWD command was not successful");

                ftp.raw.pwd(function(err, res) {
                    if (err) throw err;

                    var code = parseInt(res.code, 10);
                    assert.ok(code === 257, "PWD command was not successful");
                    assert.ok(res.text.indexOf(remoteCWD), "Unexpected CWD");
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
            ftp.list(remoteCWD, function(err, res){
                assert.ok(!err, err);
                //assert.ok(res);
                next();
            });
        });
    },

    "test ftp node stat": function(next) {
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
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
        });
    },

    "test create and delete a directory": function(next) {
        var self = this;

        var newDir = remoteCWD + "/ftp_test_dir";
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

    "test create and delete a directory containing a space": function(next) {
        var self = this;

        var newDir = remoteCWD + "/ftp test dür";
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

        var filePath = remoteCWD + "/file_ftp_test.txt";
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
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
        });
    },

    "test rename a file": function(next) {
        var self = this;

        var from = remoteCWD + "/file_ftp_test.txt";
        var to = remoteCWD + "/file_ftp_test_renamed.txt";
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            Fs.readFile(CWD + "/jsftp_test.js", "binary", function(err, data) {
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
        });
    },

    "test get a file": function(next) {
        var filePath = CWD + "/jsftp_test.js";
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            Fs.readFile(filePath, "binary", function(err, data) {
                var buffer = new Buffer(data, "binary");
                ftp.put(remoteCWD + "/test_get.js", buffer, function(err, res) {
                    assert.ok(!err, err);
                    ftp.get(remoteCWD + "/test_get.js", function(err, data) {
                        assert.ok(!err, err);

                        assert.equal(buffer.length, data.length);
                        ftp.raw.dele(remoteCWD + "/test_get.js", function(err, data) {
                            assert.ok(!err);
                            next();
                        });
                    });
                });
            });
        });
    },

    "test get two files synchronously": function(next) {
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            ftp.get(remoteCWD + "/testfile.txt", function(err, data) {
                        assert.ok(!err, err);
                        assert.ok(data);
                });
            ftp.get(remoteCWD + "/testfile.txt", function(err, data) {
                        assert.ok(!err, err);
                        assert.ok(data);
                    });
            ftp.get(remoteCWD + "/testfile.txt", function(err, data) {
                        assert.ok(!err, err);
                        assert.ok(data);
                        next()

                    });
                });
    },

    "test get fileList array": function(next) {
        var ftp = this.ftp;
        var file1 = "testfile.txt";

        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
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
        });
    },
    ">test multiple concurrent pasvs": function(next) {
        var ftp = this.ftp;
        var file1 = "testfile1.txt";
        var file2 = "testfile2.txt";
        var file3 = "testfile3.txt";

        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
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
                    assert.ok(err== null);
                    console.log(count)
                    if (++count == 3)
                        next();
                }
            });
        });
    },
    "test stat and pasv calls in parallel": function(next) {
        var ftp = this.ftp;

        ftp.ls("/", handler);
        ftp.ls("/", handler);

        var count = 0;
        function handler(err, res) {
            assert.ok(err== null);
            if (++count == 2)
                next();
        }
    }

};

!module.parent && require("asyncjs").test.testcase(module.exports, "FTP").exec();

