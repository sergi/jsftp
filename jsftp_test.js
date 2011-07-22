var assert = require("assert");
var Ftp = require("./jsftp");
var Fs = require("fs");
var exec = require('child_process').spawn;

var FTPCredentials = {
    host: "localhost",
    user: "sergi",
    port: 21,
    pass: "2x8hebsndr9"
};

var CWD = process.cwd();

// Execution ORDER: test.setUpSuite, setUp, testFn, tearDown, test.tearDownSuite
module.exports = {
    timeout: 10000,

    setUp: function(next) {
        exec('/bin/launchctl', ['load', '-w', '/System/Library/LaunchDaemons/ftp.plist']);
        var self = this;
        setTimeout(function() {
            self.ftp = new Ftp(FTPCredentials);
            next();
        }, 200);
    },

    tearDown: function(next) {
        exec('/bin/launchctl', ['unload', '-w', '/System/Library/LaunchDaemons/ftp.plist']);
        var self = this;
        next();
        setTimeout(function() {
            self.ftp = null;
            next();
        }, 200);
    },

    "test print working directory": function(next) {
        var self = this;
        this.ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(err, res) {
            self.ftp.raw.pwd(function(err, res) {
                if (err) throw err;

                var code = parseInt(res.code, 10);
                assert.ok(code === 257, "PWD command was not successful");

                self.ftp.raw.quit(function(err, res) {
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
                })

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
                console.log(res)
                next()
            })
        })
    },

    "test ftp node stat": function(next) {
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(res) {
            ftp.raw.cwd(CWD, function(err, res) {
                ftp.raw.stat(CWD, function(err, res) {
                    console.log(res.code)
                    //if (err) throw err;

                    assert.ok(res.code === 211);
                    next();
                });
            });
        });
    },

    "test passive retrieving of files": function(next) {
        next()
    },

};

!module.parent && require("./support/async/lib/test").testcase(module.exports, "FTP"/*, timeout*/).exec();
