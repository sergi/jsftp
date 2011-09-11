/*
 * @package jsFTP
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */
var assert = require("assert");
var Parser = require('./ftpParser');

module.exports = {

    timeout: 500,

    setUp : function(next) {
    },

    tearDown : function(next) {
    },

    "test ftp unix LIST responses" : function(next) {
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
                time: 1206399600000,
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
                time: 1283637600000,
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
                time: 1206399600000,
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
                time: 997360740000,
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
                time: 997268760000,
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
                time: 1232578800000,
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
                time: 1225494000000,
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
                time: 991115220000,
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
                time: 997361280000,
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
                time: 1232578800000,
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
                time: 995935320000,
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
                time: 1249250400000,
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
                time: 997361220000,
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
                time: 996912000000,
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
                time: 996909060000,
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
211--rw-r-----   1 userName alternc       560 Aug 22 03:45 test2\r\n\
211 End of status";

         var unixEntries2 = [
             {
                //line: "-rw-r--r--   1 mrclash  pg223090      260 Mar 25  2008 .alias",
                type: 0,
                size: 460,
                name: "test1",
                time: 998444700000,
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
                time: 998444700000,
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

        next();
    },
    "test ftp windows/DOS LIST responses" : function(next) {
        var dosEntries = [
            {
                line: '04-27-00  09:09PM       <DIR>          licensed',
                type: 1,
                size: 0,
                time: 956862540000,
                name: 'licensed',
            },
            {
                line: '11-18-03  10:16AM       <DIR>          pub',
                type: 1,
                size: 0,
                time: 1069146960000,
                name: 'pub',
            },
            {
                line: '04-14-99  03:47PM                  589 readme.htm',
                type: 0,
                size: 589,
                time: 924097620000,
                name: 'readme.htm'
            }
        ];

        dosEntries.forEach(function(entry) {
            var result = Parser.entryParser(entry.line);

            assert.equal(result.type, entry.type);
            assert.equal(result.size, entry.size);
            assert.equal(result.name, entry.name);
            assert.equal(result.time, entry.time);

            next();
        });
    }

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
}

!module.parent && require("asyncjs").test.testcase(module.exports, "FTP Parser").exec();

