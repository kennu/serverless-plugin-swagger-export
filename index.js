'use strict';

var path = require('path');

/**
 * Serverless Swagger Export Plugin
 * Kenneth Falck <kennu@iki.fi> 2016
 */

module.exports = function(ServerlessPlugin) { // Always pass in the ServerlessPlugin Class

  const path    = require('path'),
      fs        = require('fs'),
      BbPromise = require('bluebird'), // Serverless uses Bluebird Promises and we recommend you do to because they provide more than your average Promise :)

      // Sequelize to Swagger mapping
      swaggerTypes = {
        'string': 'string',
        'text': 'string',
        'integer': 'integer',
        'date': 'dateTime',
        'decimal': 'double'
      };

      // Mark all fields as required
      var allRequired = true;

  /**
   * ServerlessPluginSwaggerExport
   */

  class ServerlessPluginSwaggerExport extends ServerlessPlugin {

    /**
     * Constructor
     * - Keep this and don't touch it unless you know what you're doing.
     */

    constructor(S) {
      super(S);
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
      this.S.addAction(this._exportSwaggerJSON.bind(this), {
        handler:        'exportSwaggerJSON',
        description:    'Exports a Swagger JSON API definition to standard output',
        context:        'swagger',
        contextAction:  'export',
        options:        [],
        parameters:     []
      });
      return BbPromise.resolve();
    }

    /**
     * This function exports the Swagger JSON to stdout
     */
    _exportSwaggerJSON() {
      // This is the base Swagger JSON
      var swagger = {
        "swagger": "2.0",
        "info": {
          "version": this.S.state.project.version,
          "title": this.S.state.project.title,
          "description": this.S.state.project.description
        },
        "host": "localhost",
        "basePath": "/",
        "schemes": ["http"],
        "tags": [],
        "securityDefinitions": {},
        "paths": {},
        "definitions": {}
      };

      // Copy swaggerExport fields from s-project.json if present
      Object.keys(this.S.state.project.swaggerExport || {}).map((key) => {
        // Deep-copy info so subfields can be overridden individually
        if (key === 'info') {
          var subObject = this.S.state.project.swaggerExport[key];
          Object.keys(subObject).map((subkey) => {
            swagger[key][subkey] = subObject[subkey];
          });
        } else {
          swagger[key] = this.S.state.project.swaggerExport[key];
        }
      });
      return this._addSwaggerAPIPaths(swagger)
      .then(() => {
        // Generate object type definitions
        return this._addSwaggerObjectDefinitions(swagger);
      })
      .then(() => {
        // Final cleanups
        delete swagger.definitions.$sequelizeImport;
        // Output the final JSON
        console.log(JSON.stringify(swagger, null, 2));
      });
    }

    /**
     * Enumerate all API paths and add them to the Swagger JSON object
     */
    _addSwaggerAPIPaths(swagger) {
      return BbPromise.map(Object.keys(this.S.state.project.components), (componentName) => {
        return this._addSwaggerComponent(swagger, this.S.state.project.components[componentName]);
      });
    }

    _addSwaggerComponent(swagger, component) {
      return BbPromise.map(Object.keys(component.functions), (functionName) => {
        return this._addSwaggerFunction(swagger, component, component.functions[functionName]);
      });
    }

    _addSwaggerFunction(swagger, component, sfunction) {
      return BbPromise.map(sfunction.endpoints, (endpoint) => {
        return this._addSwaggerEndpoint(swagger, component, sfunction, endpoint);
      });
    }

    _addSwaggerEndpoint(swagger, component, sfunction, endpoint) {
      var url = endpoint.path;
      if (url.slice(0, 1) !== '/') {
        url = '/' + url;
      }
      var method = endpoint.method.toLowerCase();
      if (!swagger.paths[url]) swagger.paths[url] = {};
      var swaggerExport = endpoint.swaggerExport || {};
      var def = {
        "tags": [],
        "summary": "",
        "description": "",
        "operationId": method + url.replace(/\//g, '-').replace(/[{}]/g, ''),
        "produces": [ "application/json" ],
        "security": endpoint.apiKeyRequired ? [ { "apiKeyHeader": [] } ] : [],
        "parameters": [],
        "responses": {}
      };
      swagger.paths[url][method] = def;

      // Override values specified in swaggerExport
      Object.keys(swaggerExport).map((key) => {
        def[key] = swaggerExport[key];
      });

      // Add global security definition if needed
      if (def.security.length && def.security[0].apiKeyHeader && !swagger.securityDefinitions["apiKeyHeader"]) {
        swagger.securityDefinitions["apiKeyHeader"] = {
          "type": "apiKey",
          "name": "X-API-Key",
          "in": "header"
        };
      }

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
          } else if (m = requestName.match(/^method\.request\.query\.(.*)/)) {
            paramIn = 'query';
            nam = m[1];
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
      var models = require(path.join(process.cwd(), swagger.definitions.$sequelizeImport));
      var model = models[objectName];
      if (!model) {
        // Model not found, skip it
        console.error('Skipping undefined object type', objectName);
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
      swagger.definitions[objectName] = def;
      return BbPromise.resolve();
    }
  }

  // Export Plugin Class
  return ServerlessPluginSwaggerExport;

};

// Godspeed!
