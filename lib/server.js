var	_ = require('lodash'),
	fs = require('fs'),
	http = require('http'),
	cluster	= require('cluster');

module.exports = function(serverConfig) {

	var getRouter = function(app) {
		var router = app.plugins.router();

		router.on('error', function(err, results) {
	        var res = results[0].res,
	            req = results[0].req;
	        err = err || {};

	        res.statusCode = 500;
	        res.end(err.stack);
	    });

	    return router;
	};

	// create the server.
	this.start = function(callback) {

		// Create the main server
		var vhosts = {};

		// Loop over cobrands and add all of the apps by hostnames so that express can do the mapping automatically.
		_.each(serverConfig.apps, function(app) {

			// logger.info(siteConfig.hostmap);
			// consider moving the logger stuff to event emitters

			_.each(app.config.hostmap, function(host) {
				vhosts[host] = app;
				app.plugins.init(function(err) {
					if (err) {
						logger.error(err);
					}
				}); // TODO: add error checking and async callback for init.

			});
			
		});

		// Set port from server config.
		var listen = serverConfig.server.listen || {},
			lp = listen.type === 'unix' ? listen.path : listen.port;

	    // listen.host could be set to desired value though the default value (when .host is not set) is 127.0.0.1 :
	    var host = listen.host || '127.0.0.1';

		var create = function() {
			var socket = http.createServer(function (req, res) {
				var host = req.headers.host.replace(/:\d+/, ''),
					app  = vhosts[host];

				if (app) {
					getRouter(app).dispatch(req, res);
				}
				else {
					res.statusCode = 404;
					res.end("Could not find application.  Host: " + host);
				}

			}).listen(lp, host, function(err) {
				callback(err, { socket: socket });
			});
		};

		// remove old file descriptor if needed.
		if (listen.type === 'unix') {
			fs.unlink(lp, create);
		}
		else {
			create();
		}
	};
};



