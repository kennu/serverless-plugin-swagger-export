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
