'use strict';

var path = require('path');

/**
 * Serverless Swagger Export Plugin
 * Kenneth Falck <kennu@iki.fi> 2016
 */

module.exports = function(S) {

  const path    = require('path'),
      fs        = require('fs'),
      BbPromise = require('bluebird'), // Serverless uses Bluebird Promises and we recommend you do to because they provide more than your average Promise :)

      // Sequelize to Swagger mapping
      swaggerTypes = {
        'string': 'string',
        'text': 'string',
        'integer': 'number',
        'date': 'string',
        'decimal': 'number'
      };

      // Mark all fields as required
      var allRequired = true;

  /**
   * ServerlessPluginSwaggerExport
   */

  class ServerlessPluginSwaggerExport extends S.classes.Plugin {

    /**
     * Constructor
     * - Keep this and don't touch it unless you know what you're doing.
     */

    constructor() {
      super();
    }

    /**
     * Define your plugins name
     * - We recommend adding prefixing your personal domain to the name so people know the plugin author
     */

    static getName() {
      return 'net.kfalck.' + ServerlessPluginSwaggerExport.name;
    }

    /**
     * Register Actions
     * - If you would like to register a Custom Action or overwrite a Core Serverless Action, add this function.
     * - If you would like your Action to be used programatically, include a "handler" which can be called in code.
     * - If you would like your Action to be used via the CLI, include a "description", "context", "action" and any options you would like to offer.
     * - Your custom Action can be called programatically and via CLI, as in the example provided below
     */

    registerActions() {
      S.addAction(this._exportSwaggerJSON.bind(this), {
        handler:        'exportSwaggerJSON',
        description:    'Exports a Swagger JSON API definition to standard output',
        context:        'swagger',
        contextAction:  'export',
        options:       [{ 
          option:      'basePath',
          shortcut:    'b',
          description: 'Supplied basePath will be used unless overridden in s-project.json'
        }],
        parameters:     []
      });
      return BbPromise.resolve();
    }

    /**
     * This function exports the Swagger JSON to stdout
     */
    _exportSwaggerJSON(evt) {

      // This is the base Swagger JSON
      var project = S.getProject();

      let basePath = '/';
      if (evt.options.basePath) {
        basePath += evt.options.basePath;
      }

      var swagger = {
        "swagger": "2.0",
        "info": {
          "version": project.version,
          "title": project.title,
          "description": project.description
        },
        "host": "localhost",
        "basePath": basePath,
        "schemes": ["http"],
        "tags": [],
        "securityDefinitions": {},
        "paths": {},
        "definitions": {}
      };

      return BbPromise.resolve()
      .then(() => {
        // Add main project info from s-project.json
        return this._addSwaggerProjectInfo(project.swaggerExport, swagger);
      })
      .then(() => {
        // Add main project info from s-swagger.json (if exists)
        var content;
        try {
          content = fs.readFileSync(path.join(S.config.projectPath, 's-swagger.json'), 'utf-8');
        } catch (err) {
          // Ignore file not found
        }
        if (content) {
          return this._addSwaggerProjectInfo(JSON.parse(content), swagger);
        }
      })
      .then(() => {
        // Add functions and endpoints from s-function.json's
        return this._addSwaggerFunctions(project.functions, swagger);
      })
      .then(() => {
        // Add object type definitions from models
        return this._addSwaggerObjectDefinitions(swagger);
      })
      .then(() => {
        // Final cleanups
        delete swagger.definitions.$sequelizeImport;
        // Sort by URL path
        var paths = swagger.paths;
        var sortedPaths = Object.keys(swagger.paths);
        swagger.paths = {};
        sortedPaths.sort();
        sortedPaths.map(function (path) {
          swagger.paths[path] = paths[path];
        });
        // Output the final JSON
        console.log(JSON.stringify(swagger, null, 2));
      });
    }

    /**
     * Copy swaggerExport fields from s-project.json to Swagger JSON (if present)
     */
    _addSwaggerProjectInfo(swaggerExport, swagger) {
      Object.keys(swaggerExport || {}).map((key) => {
        // Deep-copy info so subfields can be overridden individually
        if (key === 'info') {
          var subObject = swaggerExport[key];
          Object.keys(subObject).map((subkey) => {
            swagger[key][subkey] = subObject[subkey];
          });
        } else {
          swagger[key] = swaggerExport[key];
        }
      });
    }

    /**
     * Enumerate all functions and add them to the Swagger JSON object
     */
    _addSwaggerFunctions(functions, swagger) {
      return BbPromise.map(Object.keys(functions), (functionName) => {
        return this._addSwaggerFunction(swagger, functions[functionName]);
      });
    }

    _addSwaggerFunction(swagger, sfunction) {
      return BbPromise.map(sfunction.endpoints, (endpoint) => {
        return this._addSwaggerEndpoint(swagger, sfunction, endpoint);
      });
    }

    _addSwaggerEndpoint(swagger, sfunction, endpoint) {
      var url = endpoint.path;
      if (url.slice(0, 1) !== '/') {
        url = '/' + url;
      }
      var method = endpoint.method.toLowerCase();
      var swaggerExport = endpoint.swaggerExport || {};
      var swaggerExt, swaggerExtContent;

      // Try to read additional endpoint specs from s-swagger.json in the same folder as s-function.json
      try {
        swaggerExtContent = fs.readFileSync(sfunction.getFilePath().replace(/s-function\.json$/, 's-swagger.json'), 'utf-8');
      } catch (err) {
        // Ignore file not found
        if (err.code != 'ENOENT') {
          console.error(err);
        }
      }
      if (swaggerExtContent) {
        swaggerExt = JSON.parse(swaggerExtContent);
      }
      if (!swaggerExt) {
        swaggerExt = {};
      }
      // If external s-swagger.json content has "paths" key defined, look up the correct path/method in it.
      // Otherwise it will match any endpoint defined in the same folder.
      if (swaggerExt.paths) {
        swaggerExt = swaggerExt.paths[url][method] || {};
      }

      // Check if endpoint is marked to be excluded
      if (swaggerExport.exclude || swaggerExt.exclude) {
        // Yes, skip this one.
        return BbPromise.resolve();
      }
      delete swaggerExport.exclude;
      delete swaggerExt.exclude;

      if (!swagger.paths[url]) swagger.paths[url] = {};

      var def = {
        "tags": [],
        "summary": "",
        "description": "",
        "operationId": method + url.replace(/\//g, '-').replace(/[{}]/g, ''),
        "produces": [ "application/json" ],
        "security": [],
        "parameters": [],
        "responses": {}
      };
      if (endpoint.apiKeyRequired) {
        // Add API key to security
        def.security.push({ "apiKeyHeader": [] });
        // Add global security definition if it's not already defined in the project
        if (!swagger.securityDefinitions["apiKeyHeader"]) {
          swagger.securityDefinitions["apiKeyHeader"] = {
            "type": "apiKey",
            "name": "X-API-Key",
            "in": "header"
          };
        }
      }
      if (endpoint.authorizationType == 'CUSTOM') {
        // Add custom authorization to security
        def.security.push({ "authorizationHeader": [] });
        // Add Authorization header to security
        if (!swagger.securityDefinitions["authorizationHeader"]) {
          swagger.securityDefinitions["authorizationHeader"] = {
            "type": "apiKey",
            "name": "Authorization",
            "in": "header"
          };
        }
      }
      swagger.paths[url][method] = def;

      // Override values specified in swaggerExport
      Object.keys(swaggerExport).map((key) => {
        def[key] = swaggerExport[key];
      });
      Object.keys(swaggerExt).map((key) => {
        def[key] = swaggerExt[key];
      });

      // Add parameters from s-function endpoint unless already specified in swaggerExport
      if (!def.parameters.length) {
        Object.keys(endpoint.requestParameters).map((parameterName) => {
          var requestName = endpoint.requestParameters[parameterName];
          var name = null;
          var paramIn = null;
          var required = false; // hard coded for now
          var type = 'string'; // hard coded for now
          var m;
          if (m = requestName.match(/^method\.request\.path\.(.*)/)) {
            paramIn = 'path';
            name = m[1];
            required = true;
          } else if (m = requestName.match(/^method\.request\.querystring\.(.*)/)) {
            paramIn = 'query';
            name = m[1];
          }
          if (name && paramIn) {
            def.parameters.push({
              "name": name,
              "in": paramIn,
              "required": required,
              "type": type
            });
          }
        });
      }

      return BbPromise.resolve();
    }

    _addSwaggerObjectDefinitions(swagger) {
      var promise = BbPromise.resolve();
      Object.keys(swagger.paths).map((path) => {
        Object.keys(swagger.paths[path]).map((method) => {
          var op = swagger.paths[path][method];
          Object.keys(op.responses).map((statusCode) => {
            var response = op.responses[statusCode];
            if (response.schema) {
              // Scan all $refs in this schema
              promise = promise.then(() => {
                return this._scanSwaggerRefs(swagger, response.schema);
              });
            }
          });
        });
      });
      return promise;
    }

    _scanSwaggerRefs(swagger, schema) {
      if (Array.isArray(schema)) {
        // Scan sub array
        return BbPromise.map(schema, (subSchema) => {
          return this._scanSwaggerRefs(swagger, subSchema);
        })
      } else if (typeof schema == 'object') {
        // Scan object keys
        return BbPromise.map(Object.keys(schema), (key) => {
          if (key === '$ref') {
            // Found a ref!
            return this._addSwaggerObjectDefinition(swagger, schema[key]);
          } else {
            return this._scanSwaggerRefs(swagger, schema[key]);
          }
        });
      } else {
        return BbPromise.resolve();
      }
    }

    _addSwaggerObjectDefinition(swagger, ref) {
      var m = ref.match(/^#\/definitions\/(.*)/);
      if (!m) return BbPromise.resolve();
      var objectName = m[1];
      if (swagger.definitions[objectName]) {
        // Already exists
        return BbPromise.resolve();
      }
      var models;
      var model;
      if (swagger.definitions.$sequelizeImport) {
        models = require(path.join(process.cwd(), swagger.definitions.$sequelizeImport));
        model = models[objectName];
      }
      if (!model) {
        // Model not found, skip it
        console.error('Warning: Undefined object type', objectName);
        return BbPromise.resolve();
      }
      var def = {
        type: 'object',
        required: [],
        properties: {}
      };
      Object.keys(model.attributes).map((attributeName) => {
        var attribute = model.attributes[attributeName];
        if (allRequired || !attribute.allowNull) {
          def.required.push(attributeName);
        }
        var type = swaggerTypes[(attribute.type.key || 'string').toLowerCase()];
        if (!type) {
          console.error('Warning: No type mapping found for', objectName + '.' + attributeName, attribute.type.key);
        }
        def.properties[attributeName] = {
          type: type || 'string',
          description: attribute.comment
        };
      });
      // Check if model has defined a swaggerExport function
      if (typeof model.swaggerExport == 'function') {
        model.swaggerExport(def);
      }
      swagger.definitions[objectName] = def;
      return BbPromise.resolve();
    }
  }

  // Export Plugin Class
  return ServerlessPluginSwaggerExport;

};

// Godspeed!
