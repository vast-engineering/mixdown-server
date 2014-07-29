var _ = require('lodash');
var http = require('http');
var util = require('util');
var events = require('events');
var fs = require('fs');

var Worker = function(mixdown, options, callback) {
  var self = this;
  self.vhosts = {};
  self.mixdown = mixdown;
  self.options = options;

  this.on('request', this.handleRequest);

  /**
   * Setting up connection in cluster child process actually shares socket between child processes.
   * There is no need to load-balance or dispatch requests between nodes.
   * 
   * @see http://nodejs.org/api/cluster.html#cluster_cluster
   */
  (function setupConnection() {
    var listen = self.options.listen || {};

    if (listen.type !== 'unix' && !isNaN(process.env.MIXDOWN_PORT)) {
      listen.port = process.env.MIXDOWN_PORT;
    }

    var lp = listen.type === 'unix' ? listen.path : listen.port;

    var startListening = function () {

      self.server = http.createServer();
      self.server.on('connection', function (socket) {
        http._connectionListener.call(self, socket);
      });
      
      self.server.listen(lp, callback);
    };

    // remove socket file descriptor before connecting.
    if (listen.type === 'unix') {
      fs.unlink(lp, startListening);
    }
    else {
      startListening();
    }
  })();

  //this is a bit of a problem, it is an async function in the constructor
  //also i don't think it's necessary as mixdown will do this?
  mixdown.getExternalConfig(function(err, externalConfig) {
    if (err) {
      logger.error(err);
    }
    else if (externalConfig) {

      logger.info('External Config initialized: ' + util.inspect(externalConfig));
      externalConfig.on('update', function(services) {
        var servs;
        var overlays;

        if (services && services.length) {
          overlays = _.filter(services, function(s) { return s.overlay === true; });
          servs = _.reject(services, function(s) { return s.overlay === true; });
        }
        else{
          logger.error('no services were returned after the configuration change');
          return;
        }

        mixdown.overlays = overlays;
        mixdown.services = servs;

        mixdown.initServices(function(err) {
          if (err) {
            logger.error('Site refresh failed: ', err);
          }
          else {
            self.reload();
            mixdown.emit('reload', mixdown);
          }
        });
      });
    }
  });

  //need to do this incase process.send is not defined
  //which will be the case when cluster is off
  if(process.send){
    process.send('ready');  
  }
  
};

util.inherits(Worker, events.EventEmitter);

Worker.prototype.getRouter = function(app) {
  var router = _.isFunction(app.plugins.router) ? app.plugins.router() : app.plugins.router.create();

  router.on('error', function(err, results) {
    var httpContext = results[0].httpContext || {};

    var res = httpContext.response || results[0].res,
        req = httpContext.request ||results[0].req;
    err = err || {};

    res.statusCode = 500;
    res.end(err.stack);
  });

  return router;
};

Worker.prototype.reload = function() {

  // Reset vhosts
  var vhosts = {};

  // Loop over cobrands and add all of the apps by hostnames.
  _.each(this.mixdown.apps, function(app) {

    app.plugins.init(function(err) {
      if (err) {
        logger.error(err);
      }
    }); // TODO: add error emitter.

    // map the vhost
    _.each(app.config.vhosts, function(host) {
      vhosts[host] = app;
    });

  });

  this.vhosts = vhosts;
};

Worker.prototype.handleRequest = function(req, res) {
  var app = null;
  var host = null;

  // for simple case, listen on all hosts.
  var appkeys = Object.keys(this.mixdown.apps);

  if (appkeys.length === 1) {
    app = this.mixdown.apps[appkeys[0]];
  }
  else {
    host = req.headers.host.replace(/:\d+/, '');
    app  = this.vhosts[host];
  }

  // send to router.
  if (app) {
    this.getRouter(app).dispatch(req, res);
  }
  else {
    res.statusCode = 404;
    res.end("Could not find application.  Host: " + host);
  }
};

module.exports = Worker;