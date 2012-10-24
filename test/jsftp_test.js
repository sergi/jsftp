#!/usr/bin/env node
/*
 * @package jsftp
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi.mansilla@gmail.com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

"use strict";

var assert = require("assert");
var Fs = require("fs");
var exec = require('child_process').spawn;
var Ftp = require("../");
var Parser = require('../lib/ftpParser');
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

describe("jsftp file listing parser", function() {
    it("test ftp unix LIST responses", function() {
        var str = "211-Status of /:\r\n\
 drwx--x---  10 mrclash  adm          4096 Aug  9 14:48 .\r\n\
 drwx--x---  10 mrclash  adm          4096 Aug  9 14:48 ..\r\n\
 -rw-r--r--   1 mrclash  pg223090      260 Mar 25  2008 .alias\r\n\
 -rw-------   1 mrclash  pg223090     2219 Sep  5  2010 .bash_history\r\n\
 -rw-r--r--   1 mrclash  pg223090       55 Mar 25  2008 .bashrc\r\n\
 drwx------   2 mrclash  pg223090     4096 Aug  9 14:39 .ssh\r\n\
 -rw-r--r--   1 mrclash  pg223090       18 Aug  8 13:06 Cloud9 FTP connection test.\r\n\
 -rwxr-xr-x   1 mrclash  pg223090 68491314 Jan 22  2009 Documents.zip\r\n\
 -rwxr-xr-x   1 mrclash  pg223090      141 Nov  1  2008 EcPxMptYISIdOSjS.XFV.Q--.html\r\n\
 dr-xr-x---   7 mrclash  dhapache     4096 May 29 07:47 logs\r\n\
 drwxr-xr-x   7 mrclash  pg223090     4096 Aug  9 14:48 re-alpine.git\r\n\
 -rwxr-xr-x   1 mrclash  pg223090   312115 Jan 22  2009 restaurants.csv\r\n\
 drwxr-xr-x  12 mrclash  pg223090     4096 Jul 24 02:42 sergimansilla.com\r\n\
 drwxr-xr-x  10 mrclash  pg223090     4096 Aug  3  2009 svn\r\n\
 -rwxr-xr-x   1 mrclash  pg223090       76 Aug  9 14:47 sync-alpine.sh\r\n\
 drwxr-xr-x   2 mrclash  pg223090     4096 Aug  4 10:00 test_c9\r\n\
 -rw-r--r--   1 mrclash  pg223090        4 Aug  4 09:11 testfile.txt\r\n\
211 End of status";

        var unixEntries = [
            {
                //line: "-rw-r--r--   1 mrclash  pg223090      260 Mar 25  2008 .alias",
                type: 0,
                size: 260,
                name: ".alias",
                time: +new Date("Mar 25  2008"),
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : false,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : false,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : false
            },
            {
                //line: "-rw-------   1 mrclash  pg223090     2219 Sep  5  2010 .bash_history",
                type: 0,
                size: 2219,
                name: ".bash_history",
                time: +new Date("Sep  5  2010"),
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : false,

                groupReadPerm  : false,
                groupWritePerm : false,
                groupExecPerm  : false,

                otherReadPerm  : false,
                otherWritePerm : false,
                otherExecPerm  : false
            },
            {
                type: 0,
                size: 55,
                name: ".bashrc",
                time: +new Date("Mar 25  2008"),
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : false,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : false,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : false
            },
            {
                type: 1,
                size: 4096,
                name: ".ssh",
                time: +new Date("Aug  9 14:39 " + new Date().getFullYear()),
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : false,
                groupWritePerm : false,
                groupExecPerm  : false,

                otherReadPerm  : false,
                otherWritePerm : false,
                otherExecPerm  : false
            },
            {
                type: 0,
                size: 18,
                name: "Cloud9 FTP connection test.",
                time: +new Date("Aug  8 13:06 " + new Date().getFullYear()),
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : false,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : false,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : false
            },
            {
                type: 0,
                size: 68491314,
                name: "Documents.zip",
                time: +new Date("Jan 22  2009"),
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : true
            },
            {
                type: 0,
                size: 141,
                name: "EcPxMptYISIdOSjS.XFV.Q--.html",
                time: +new Date("Nov  1  2008"),
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : true
            },
            {
                type: 1,
                size: 4096,
                name: "logs",
                time: +new Date("May 29 07:47 " + new Date().getFullYear()),
                owner: "mrclash",
                group: "dhapache",

                userReadPerm  : true,
                userWritePerm : false,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : false,
                otherWritePerm : false,
                otherExecPerm  : false
            },
            {
                type: 1,
                size: 4096,
                name: "re-alpine.git",
                time: +new Date("Aug  9 14:48 " + new Date().getFullYear()),
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : true
            },
            {
                type: 0,
                size: 312115,
                time: +new Date("Jan 22  2009"),
                name: "restaurants.csv",
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : true
            },
            {
                type: 1,
                size: 4096,
                time: +new Date("Jul 24 02:42 " + new Date().getFullYear()),
                name: "sergimansilla.com",
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : true
            },
            {
                type: 1,
                size: 4096,
                time: +new Date("Aug  3  2009"),
                name: "svn",
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : true
            },
            {
                type: 0,
                size: 76,
                time: +new Date("Aug  9 14:47 " + new Date().getFullYear()),
                name: "sync-alpine.sh",
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : true
            },
            {
                type: 1,
                size: 4096,
                time: +new Date("Aug  4 10:00 " + new Date().getFullYear()),
                name: "test_c9",
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : true,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : true,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : true
            },
            {
                type: 0,
                size: 4,
                time: +new Date("Aug  4 09:11 " + new Date().getFullYear()),
                name: "testfile.txt",
                owner: "mrclash",
                group: "pg223090",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : false,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : false,

                otherReadPerm  : true,
                otherWritePerm : false,
                otherExecPerm  : false
            }
        ];

        var str2 = "211-Status of /www/userName/test:\
211-drwxr-x---   2 userName alternc      4096 Aug 22 03:45 .\r\n\
211-drwxr-x---   5 userName alternc      4096 Aug 22 03:45 ..\r\n\
211--rw-r-----   1 userName alternc       460 Aug 22 03:45 test1\r\n\
211--rw-r-----   1 userName alternc       560 Aug 22 03:47 test2\r\n\
211 End of status";

         var unixEntries2 = [
             {
                //line: "-rw-r--r--   1 mrclash  pg223090      260 Mar 25  2008 .alias",
                type: 0,
                size: 460,
                name: "test1",
                time: +new Date("Aug 22 03:45 " + new Date().getFullYear()),
                owner: "userName",
                group: "alternc",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : false,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : false,

                otherReadPerm  : false,
                otherWritePerm : false,
                otherExecPerm  : false
            },
            {
                //line: "-rw-r--r--   1 mrclash  pg223090      260 Mar 25  2008 .alias",
                type: 0,
                size: 560,
                name: "test2",
                time: +new Date("Aug 22 03:47 " + new Date().getFullYear()),
                owner: "userName",
                group: "alternc",

                userReadPerm  : true,
                userWritePerm : true,
                userExecPerm  : false,

                groupReadPerm  : true,
                groupWritePerm : false,
                groupExecPerm  : false,

                otherReadPerm  : false,
                otherWritePerm : false,
                otherExecPerm  : false
            }
        ]

        str
            .split(/\r\n/)
            .map(function(entry) {
                return Parser.entryParser(entry.replace("\n", ""));
            })
            // Flatten the array
            .filter(function(value){ return !!value; })
            .forEach(function(entry, i) {
                assert.equal(unixEntries[i].type, entry.type);
                assert.equal(unixEntries[i].size, entry.size);
                assert.equal(unixEntries[i].name, entry.name);
                assert.equal(unixEntries[i].time, entry.time);
                assert.equal(unixEntries[i].owner, entry.owner);
                assert.equal(unixEntries[i].group, entry.group);

                assert.equal(unixEntries[i].userReadPerm,   entry.userPermissions.read);
                assert.equal(unixEntries[i].userWritePerm,  entry.userPermissions.write);
                assert.equal(unixEntries[i].userExecPerm,   entry.userPermissions.exec);

                assert.equal(unixEntries[i].groupReadPerm,  entry.groupPermissions.read);
                assert.equal(unixEntries[i].groupWritePerm, entry.groupPermissions.write);
                assert.equal(unixEntries[i].groupExecPerm,  entry.groupPermissions.exec);

                assert.equal(unixEntries[i].otherReadPerm,  entry.otherPermissions.read);
                assert.equal(unixEntries[i].otherWritePerm, entry.otherPermissions.write);
                assert.equal(unixEntries[i].otherExecPerm,  entry.otherPermissions.exec);
            });

        str2
            .split(/\r\n/)
            .map(function(entry) {
                return Parser.entryParser(entry.replace("\n", ""));
            })
            // Flatten the array
            .filter(function(value){ return !!value; })
            .forEach(function(entry, i) {
                assert.equal(unixEntries2[i].type, entry.type);
                assert.equal(unixEntries2[i].size, entry.size);
                assert.equal(unixEntries2[i].name, entry.name);
                assert.equal(unixEntries2[i].time, entry.time);
                assert.equal(unixEntries2[i].owner, entry.owner);
                assert.equal(unixEntries2[i].group, entry.group);

                assert.equal(unixEntries2[i].userReadPerm,   entry.userPermissions.read);
                assert.equal(unixEntries2[i].userWritePerm,  entry.userPermissions.write);
                assert.equal(unixEntries2[i].userExecPerm,   entry.userPermissions.exec);

                assert.equal(unixEntries2[i].groupReadPerm,  entry.groupPermissions.read);
                assert.equal(unixEntries2[i].groupWritePerm, entry.groupPermissions.write);
                assert.equal(unixEntries2[i].groupExecPerm,  entry.groupPermissions.exec);

                assert.equal(unixEntries2[i].otherReadPerm,  entry.otherPermissions.read);
                assert.equal(unixEntries2[i].otherWritePerm, entry.otherPermissions.write);
                assert.equal(unixEntries2[i].otherExecPerm,  entry.otherPermissions.exec);
            });
    });

    it("test ftp windows/DOS LIST responses" , function() {
        var dosEntries = [
            {
                line: '04-27-00  09:09PM       <DIR>          licensed',
                type: 1,
                size: 0,
                time: +(new Date("04-27-00  09:09 PM")),
                name: 'licensed',
            },
            {
                line: '11-18-03  10:16AM       <DIR>          pub',
                type: 1,
                size: 0,
                time: +(new Date("11-18-03  10:16 AM")),
                name: 'pub',
            },
            {
                line: '04-14-99  03:47PM                  589 readme.htm',
                type: 0,
                size: 589,
                time: +(new Date("04-14-99  03:47 PM")),
                name: 'readme.htm'
            }
        ];

        dosEntries.forEach(function(entry) {
            var result = Parser.entryParser(entry.line);

            assert.equal(result.type, entry.type);
            assert.equal(result.size, entry.size);
            assert.equal(result.name, entry.name);
            assert.equal(result.time, entry.time);
        });
    });

    /*
     * We are not supporting MLSx commands yet
     *
     * http://rfc-ref.org/RFC-TEXTS/3659/chapter7.html
     * http://www.rhinosoft.com/newsletter/NewsL2005-07-06.asp?prod=rs
     *
    "test parse MLSD command lines" : function(next) {
        var lines = [
            {
                line: "Type=file;Size=17709913;Modify=20050502182143; Choices.mp3",
                Type: "file",
                Size: "17709913",
                Modify: "20050502182143",
                name: "Choices.mp3"
            },
            {
                line: "Type=cdir;Perm=el;Unique=keVO1+ZF4; test",
                type: "file",
                perm: "el",

            },
            {
                line: "Type=pdir;Perm=e;Unique=keVO1+d?3; .."
            }
        ];




        //"Type=cdir;Perm=el;Unique=keVO1+ZF4; test",
        //"Type=pdir;Perm=e;Unique=keVO1+d?3; ..",
        //"Type=OS.unix=slink:/foobar;Perm=;Unique=keVO1+4G4; foobar",
        //"Type=OS.unix=chr-13/29;Perm=;Unique=keVO1+5G4; device",
        //"Type=OS.unix=blk-11/108;Perm=;Unique=keVO1+6G4; block",
        //"Type=file;Perm=awr;Unique=keVO1+8G4; writable",
        //"Type=dir;Perm=cpmel;Unique=keVO1+7G4; promiscuous",
        //"Type=dir;Perm=;Unique=keVO1+1t2; no-exec",
        //"Type=file;Perm=r;Unique=keVO1+EG4; two words",
        //"Type=file;Perm=r;Unique=keVO1+IH4;  leading space",
        //"Type=file;Perm=r;Unique=keVO1+1G4; file1",
        //"Type=dir;Perm=cpmel;Unique=keVO1+7G4; incoming",
        //"Type=file;Perm=r;Unique=keVO1+1G4; file2",
        //"Type=file;Perm=r;Unique=keVO1+1G4; file3",
        //"Type=file;Perm=r;Unique=keVO1+1G4; file4",

        var parsed = Parser.parseMList(line);

        assert.equal("file", parsed.Type);
        assert.equal("17709913", parsed.Size);
        assert.equal("20050502182143", parsed.Modify);
        assert.equal("Choices.mp3", parsed.name);
        next();
    }
    */
})

describe("jsftp test suite", function() {
    var ftp;
    beforeEach(function(next) {
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
            ftp = new Ftp(FTPCredentials);
            next();
        }, 200);
    });

    afterEach(function(next) {
        if (daemon)
            daemon.kill();

        var self = this;
        setTimeout(function() {
            ftp.destroy();
            ftp = null;
            next();
        }, 200);
    }),

    it("test features command", function(next) {
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            assert.ok(Array.isArray(ftp.features));

            if (ftp.features.length) {
                var feat = ftp.features[0];
                assert.ok(ftp.hasFeat(feat));
            }
            next();
        });
    });

    it("test initialize", function(next) {
        assert.equal(ftp.options, FTPCredentials);
        assert.equal(ftp.host, FTPCredentials.host);
        assert.equal(ftp.port, FTPCredentials.port);
        assert.equal(ftp.onError, null);
        assert.equal(ftp.onTimeout, null);
        assert.equal(ftp.onConnect, null);

        next();
    });

    it("test print working directory", function(next) {
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

    it("test current working directory", function(next) {
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
    });

    it("test passive listing of current directory", function(next) {
        ftp.list(remoteCWD, function(err, res){
            assert.ok(!err, err);
            next();
        });
    });

    it("test ftp node stat", function(next) {
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

    it("test create and delete a directory", function(next) {
        var self = this;

        var newDir = remoteCWD + "/ftp_test_dir";
        ftp.raw.mkd(newDir, function(err, res) {
            assert.ok(!err);
            assert.equal(res.code, 257);

            ftp.raw.rmd(newDir, function(err, res) {
                assert.ok(!err);
                next();
            });
        });
    });

    it("test create and delete a directory containing a space", function(next) {
        var self = this;
        var newDir = remoteCWD + "/ftp test dür";
        ftp.raw.mkd(newDir, function(err, res) {
            assert.ok(!err);
            assert.equal(res.code, 257);

            ftp.raw.rmd(newDir, function(err, res) {
                assert.ok(!err);
                next();
            });
        });
    });

    it("test create and delete a file", function(next) {
        var self = this;
        var filePath = remoteCWD + "/file_ftp_test.txt";
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

    it("test rename a file", function(next) {
        var self = this;
        var from = remoteCWD + "/file_ftp_test.txt";
        var to = remoteCWD + "/file_ftp_test_renamed.txt";
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
    });

    it("test get a file", function(next) {
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
    });

    it("test get two files synchronously", function(next) {
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
    });

    it("test get fileList array", function(next) {
        var file1 = "testfile.txt";

        ftp.raw.pwd(function(err, res) {
            var parent, pathDir, path;
	    var path = remoteCWD + "/" + file1;

            ftp.put(path, new Buffer("test"), function(err, res) {
                assert.ok(!err);

                ftp.raw.cwd(remoteCWD + "/", function(err, res) {
                    ftp.ls(".", function(err, res) {
                        assert.ok(!err, err);

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

    it("test multiple concurrent pasvs", function(next) {
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
    });

    it("test stat and pasv calls in parallel without auth", function(next) {
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
    });

    it("test reconnect", function(next) {
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
    });
});

