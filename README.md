# Swagger Export Plugin for Serverless
Kenneth Falck <kennu@iki.fi> 2016

This is a plugin that exports a Swagger JSON API definition file
based on your Serverless project structure.

**Note:** Serverless *v0.4.0* or higher is required.

## Installation

First install the plugin into your Serverless project:

    npm install --save serverless-plugin-swagger-export

Then edit your **s-project.json**, locate the plugins: [] section, and add
the plugin as follows:

    plugins: [
        "serverless-plugin-swagger-export"
    ]

## Usage

To autogenerate a Swagger JSON API definition, use this command:

    sls swagger export

## Customizing exported API documentation

You can add a JSON element called "swaggerExport" in various Serverless
project files to add documentation and other info to the exported
Swagger JSON.

In **s-project.json**, you can override top level Swagger JSON elements
like this:

    "name": "MyServerlessProject",
    "version": "1.0.0",
    "swaggerExport": {
      "info": {
        "title": "Overridden title",
        "description": "Overridden description"
      },
      "host": "example.com"
    }

Any elements you specify under swaggerExport will replace the defaults.

In **s-function.json**, you can add Swagger documentation to each endpoint
like this:

    "path": "myapi",
    "method": "GET",
    "type": "AWS",
    "authorizationType": "none",
    "apiKeyRequired": true,
    "swaggerExport": {
      "tags": ["My Swagger Tag"],
      "summary": "Swagger summary",
      "description": "Swagger description",
      "parameters": [],
      "responses": {}
    }

Please see Swagger documentation for more details on all the fields.

## Generating object definitions from Sequelize models

If your project uses Sequelize to define data models, they can be
automatically exported in the Swagger JSON. To enable this, you need to have
one Node.js module that exports all the models using the names that you
want to use in Swagger. Then add this to **s-project.json**:

    "swaggerExport": {
      "definitions": {
        "$sequelizeImport": "path/to/module"
      }
    }

Now you can add Swagger responses that use $refs like this:

    "200": {
      "description": "Successful operation",
      "schema": {
        "$ref": "#/definitions/MyDataModel"
      }
    }

Assuming MyDataModel is found in your module, it will be added to the
definitions element in the exported Swagger JSON.
