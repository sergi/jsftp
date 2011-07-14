var Ftp = require("./jsftp");
// Fire it up. For test purposes only!
var ftp = new Ftp({
    port: 2021,
    host: "localhost",
    user: "sergi",
});


//ftp.stat("/", function() {
ftp.cwd("/Users/sergi/", function(res) {
    if (res.code == 250 || res.code == 200) {
        ftp.pwd(function(res) {
            console.log("All together now: ", res);
            ftp.syst();
            ftp.pwd();
            ftp.list("/Users/sergi/", function(err, data) {
                console.log(data);
                console.log("Listed!");
            })
        });
    }
});
//});
//ftp.setBinary(true);
setTimeout(function(){ ftp.quit(); }, 5000);
