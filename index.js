var _ = require('lodash');
var cluster = require('cluster');
var Worker = require('./lib/worker.js');

// Export the factory
module.exports.create = function (mixdown, options) {
  return new Main(mixdown, options);
};

var Main = function (mixdownConfig, serverOptions) {
  this.mixdown = mixdownConfig;

  this.options = _.defaults(serverOptions || {}, {
    cluster: {
      on: false
    }
  });
};

var logServerInfo = function (server, message) {
  var hmap = _.map(server.mixdown.apps, function (app) {
    return _.pick(app, 'vhosts', 'id');
  });

  var address = server.server && server.server.address();
  logger.info(message || 'Server Information. ', address || ' ', hmap);
};

Main.prototype.createMaster = function (callback) {
  var self = this;

  if (!self.options.cluster.on) {
    logger.info('Starting master server pid: ' + process.pid);
    var master = new Worker(self.mixdown, self.options);
  }

  logServerInfo(self, 'Server started successfully.');

  if (_.isFunction(callback)) callback(null);
};

Main.prototype.stop = function () {
  throw new Error('stop() not implemented on server.  TODO.');
};

Main.prototype.start = function (callback) {
  var self = this;
  var mixdown = this.mixdown;
  var options = this.options;

  // this reload listener just logs the reload info.
  mixdown.on('reload', function () {
    logServerInfo(self, 'Mixdown reloaded. ');
  });

  if (options.cluster.on) {
    // Start cluster.
    var numChildrenToSpawn = options.cluster.workers || require('os').cpus().length;

    if (cluster.isMaster) {
      logger.info("Using cluster.");
      //cluster is on, and this is the master!
      logger.info("Starting master with " + numChildrenToSpawn + " workers.");

      // spawn n workers
      for (var i = 0; i < numChildrenToSpawn; i++) {
        var child = cluster.fork();
        logger.debug('Initializing worker pid: ' + child.process.pid);
      }

      // Add application kill signals.
      var signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
      _.each(signals, function (sig) {

        process.on(sig, function () {

          _.each(cluster.workers, function (child) {
            child.destroy();  // send suicide signal
          });

          // create function to check self all workers are dead.
          var checkExit = function () {
            if (_.keys(cluster.workers).length === 0) {
              process.exit();
            }
            else {
              setImmediate(checkExit);   // keep polling for safe shutdown.
            }
          };

          // poll the master and exit when children are all gone.
          setImmediate(checkExit);
        });
      });

      cluster.on('disconnect', function (worker) {
        logger.info('Worker ' + worker.process.pid + ' disconnected.');
      });

      cluster.on('exit', function (worker, code, signal) {

        // if it purposely destroyed itself, then do no re-spawn.
        if (!worker.suicide) {
          var message = 'Worker exited unexpectedly. Spawning new worker. Code: ' + code + ', Signal: ' + signal;
          
          if (worker.error && worker.error.stack) {
            message += ', Error: ' + error.stack;
          }

          logger.error(message);

          var child = cluster.fork();
          logger.debug('Restarting child with pid: ' + child.process.pid + '...');
        }
      });

      self.createMaster(callback);

    }
    else if (cluster.isWorker) {
      //cluster is on, and this is a worker.
      logger.info("I'm a new worker Worker pid: " + process.pid);

      try {
        var worker = new Worker(mixdown, options);
      }
      catch (e) {
        if (_.isFunction(callback)) callback(e, self);
      }
    }
  }
  else if (!options.cluster.on) {
    logger.info("Standalone (non-clustered) server.");
    self.createMaster(callback);
  }
};

