'use strict';

var ServiceRegistry = require( 'br/ServiceRegistry' )

var InputDirective = function() {
	this.restrict = 'AEC';
	this.scope = {
		service: '@',
		username: '@'
	};

	var HtmlService = ServiceRegistry.getService( 'br.html-service' )
	this.template = HtmlService.getHTMLTemplate( 'brjstodo.ng.input.view-template' )
};

module.exports = InputDirective;
