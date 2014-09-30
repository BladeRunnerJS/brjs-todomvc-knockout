// browser-modules
(function() {
	"use strict";

	/*
	 * This provides a relatively simple define/require that can be used in the browser.  It's close
	 * to commonJS compliant, and allows the node style extension - module.exports = ...
	 *
	 * While it looks a little like the 'commonJS' wrapping described in the RequireJS documentation,
	 * it's synchronous.  Everything that is required must have been previously defined or an error
	 * will be thrown.
	 *
	 * There's a decent chance if you're looking at this that your needs might be better served by
	 * browserify.  Check it out if you haven't already.
	 *
	 * There are some extra features such as hierarchical realms, but to get started with the basics,
	 * include this file and then call realm.install().
	 *
	 * Warning: having a global 'define' method may be enough to trigger AMD definitions in some UMD
	 * modules. They should really check for define.AMD, but not all of them do. This will work some
	 * of the time, but this code is really designed to work with commonJS and node style modules. If
	 * this is likely to be a problem, you might want to avoid calling .install().
	 */

	var global = Function("return this;")();
	
	var create = Object.create || function(proto, attributes) {
		function object() {};
		object.prototype = proto;
		var result = new object();
		for (var key in attributes) {
			result[key] = attributes[key].value;
		}
		return result;
	};

	function derelativise(context, path) {
		var result = (context === "" || path.charAt(0) !== '.') ? [] : context.split("/");
		var working = path.split("/");
		var item;
		while (item = working.shift()) {
			if (item === "..") {
				result.pop();
			} else if (item !== ".") {
				result.push(item);
			}
		}
		return result.join("/");
	}

	// Using a marker object allows us to distinguish between things that are explicitly set to
	// undefined and things that are not set.
	var NOT_FOUND = {};

	// This is a 'require' that just returns a global.
	function globalResolve(moduleId) {
		if (moduleId in global) {
			return global[moduleId];
		}

		// We'll try walking the object tree too.  This supports libraries that use objects for
		// namespacing.
		var result = global;
		var scopes = moduleId.split("/");
		for (var i = 0, length = scopes.length; i < length; ++i) {
			var scope = scopes[i];
			if (scope in result) {
				result = result[scope];
			} else {
				result = NOT_FOUND;
				break;
			}
		}
		if (result !== NOT_FOUND) {
			return result;
		}
		throw new Error("No definition for module " + moduleId + " could be found in the global top level.");
	}

	function Realm(fallbackRequire) {
		this.moduleDefinitions = {};
		this.incompleteExports = {};
		this.moduleExports = {};
		this.modulesFromParent = {};
		this.fallbackRequire = fallbackRequire;
		this.installedData = null;
		
		var realm = this;
		this.require = function() {
			return realm._require.apply(realm, arguments);
		};
		this.define = function() {
			realm._define.apply(realm, arguments);
		};
	}

	Realm.prototype.install = function install(target) {
		target = target || global;
		if (this.installedData === null) {
			this.installedData = {
				target: target,
				define: target.define,
				require: target.require
			};
			target.define = this.define;
			target.require = this.require;
		} else {
			throw new Error("Can only install to one place at once.");
		}
	};

	Realm.prototype.uninstall = function uninstall() {
		if (this.installedData !== null) {
			this.installedData.target.define = this.installedData.define;
			this.installedData.target.require = this.installedData.require;
			this.installedData = null;
		}
	};

	Realm.prototype._define = function define(id, definition) {
		if (this.modulesFromParent[id] === true) {
			throw new Error('Module ' + id + ' has already been loaded from a parent realm.  If you are sure that you want to override an already loaded parent module, you need to undefine this module or reset this realm first.');
		}
		// remove .js from the end of ids.
		id = id.replace(/\.js$/, "");
		if (id in this.moduleDefinitions) {
			throw new Error('Module ' + id + ' has already been defined and cannot be defined a second time.  If you are sure that you want to redefine this module, you need to undefine this module or reset this realm first.');
		}

		this.moduleDefinitions[id] = definition;
	};

	Realm.prototype.load = function load(id, definitionString) {
		define(id, eval("(function(require, exports, module){\n" + definitionString + "\n});"));
	};

	Realm.prototype._require = function require(context, id) {
		if (arguments.length === 1) {
			id = arguments[0];
			context = '';
		}

		var originalId = id;
		// we ignore .js on the end of require requests.
		id = derelativise(context, id).replace(/\.js$/, "");

		// Has already been instantiated
		if (this.moduleExports[id] != null) {
			return this.moduleExports[id];
		}

		if (this.incompleteExports[id] != null) {
			// There is a circular dependency; we do the best we can in the circumstances.
			// You should avoid doing module.exports= or returning something from the definition
			// function if your module is likely to be involved in a circular dependency since
			// the incompleteExports will be wrong in that case.
			return this.incompleteExports[id].exports;
		}

		var definition = this._getDefinition(id);
		if (definition == null) {
			if (this.fallbackRequire !== null) {
				var result = this.fallbackRequire(originalId);
				this.modulesFromParent[id] = true;
				return result;
			}
			throw new Error("No definition for module " + id + " has been loaded.");
		}

		// For closer spec compliance we should define id as a nonconfigurable, nonwritable
		// property, but this at least works OK in non-es5 browsers (like ie8).
		var module = { id: id, exports: {} };
		this.incompleteExports[id] = module;
		try {
			if (typeof definition === 'function') {
				var idx = id.lastIndexOf("/");
				// At the top level the context is the module id, at other levels, the context is the
				// path to the module. This is because we assume that everything at the top level is
				// a directory module and everything else is a file module.
				var definitionContext = id;
				if (idx >= 0) {
					definitionContext = id.substring(0, id.lastIndexOf("/"));
				}
				// this is set to the module inside the definition code.
				var returnValue = definition.call(module, function(requirePath) {
					return window.require(definitionContext, requirePath);
				}, module.exports, module);
				this.moduleExports[id] = returnValue || module.exports;
			} else {
				// this lets you define things without definition functions, e.g.
				//    define('PI', 3); // Indiana House of Representatives compliant definition of PI
				// If you want to define something to be a function, you'll need to define a function
				// that sets module.exports to a function (or returns it).
				this.moduleExports[id] = definition;
			}
		} finally {
			// If there was an error, we want to run the definition again next time it is required
			// so we clean up whether it succeeded or failed.
			delete this.incompleteExports[id];
		}
		return this.moduleExports[id];
	};

	Realm.prototype.subrealm = function(fallbackRequire) {
		return new SubRealm(this, fallbackRequire);
	};

	Realm.prototype._getDefinition = function(id) {
		return this.moduleDefinitions[id];
	};

	// Subrealm ////////////////////////////////////////////////////////////////////////////

	/*
	 * Subrealms are for testing.  A subrealm is a brand new realm that will fallback to
	 * taking definitions from its parent realm if no definition is defined.
	 */
	function SubRealm(parentRealm, fallbackRequire) {
		Realm.call(this, fallbackRequire || parentRealm.fallbackRequire);
		this.parentRealm = parentRealm;
	}

	SubRealm.prototype = create(Realm.prototype, {
		constructor: {value: SubRealm, enumerable: false, configurable: true, writable: true}
	});

	SubRealm.prototype._getDefinition = function(id, originalId) {
		return this.moduleDefinitions[id] || this.parentRealm._getDefinition(id, originalId);
	};

	// initialisation //////////////////////////////////////////////////////////////////////

	var defaultRealm = new Realm(global.require || globalResolve);

	if (typeof module !== 'undefined') {
		// for node.js
		module.exports = defaultRealm;
	} else {
		// for the browser
		global.realm = defaultRealm;
	}
})();

realm.install();

define('browser-modules', function(require, exports, module) {
module.exports = {};
});


window.browser_modules = require('browser-modules');

// br-ie8-shim
// see <http://www.adequatelygood.com/2011/4/Replacing-setTimeout-Globally> for info
if((navigator.appName == 'Microsoft Internet Explorer') && (navigator.userAgent.match(/MSIE ([0-9]+)/)[1] <= 8))
{
	var pProperties = ["alert", "setTimeout", "clearTimeout", "setInterval", "clearInterval"];
	for(var i = 0, l = pProperties.length; i < l; ++i)
	{
		var sProperty = pProperties[i];
		var fNativePropertyAccessor = window[sProperty];
		eval("var " + sProperty + ";");
		window[sProperty] = fNativePropertyAccessor;
	}
}

if (!Function.prototype['bind']) {
	// 24/01/2011 - AmirH - changed for better performance when there are no arguments to be curried.
	// Function.prototype.bind is a standard part of ECMAScript 5th Edition (December 2009, http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-262.pdf)
	// In case the browser doesn't implement it natively, provide a JavaScript implementation. This implementation is based on the one in prototype.js
	Function.prototype['bind'] = function (object) {
		var originalFunction = this;
		
		if (arguments.length === 1) {
			return function () {
					return originalFunction.apply(object, arguments);
				};
		} else {
			var args = Array.prototype.slice.call(arguments, 1);
			return function () {
				return originalFunction.apply(object, args.concat(Array.prototype.slice.call(arguments)));
			};
		}
	};
}


define('br-ie8-shim', function(require, exports, module) {
module.exports = null;
});


window.br_ie8_shim = require('br-ie8-shim');

// html5shiv
/*! HTML5 Shiv v3.6.1 | @afarkas @jdalton @jon_neal @rem | MIT/GPL2 Licensed */
;(function(window, document) {
  // *** Added by Caplin so this library can be used with our thirdparty library mechanism ***
  if((navigator.appName != 'Microsoft Internet Explorer') || (navigator.userAgent.match(/MSIE ([0-9]+)/)[1] > 8))
    return;
    
/*jshint evil:true */
  /** Preset options */
  var options = window.html5 || {};

  /** Used to skip problem elements */
  var reSkip = /^<|^(?:button|map|select|textarea|object|iframe|option|optgroup)$/i;

  /** Not all elements can be cloned in IE **/
  var saveClones = /^(?:a|b|code|div|fieldset|h1|h2|h3|h4|h5|h6|i|label|li|ol|p|q|span|strong|style|table|tbody|td|th|tr|ul)$/i;

  /** Detect whether the browser supports default html5 styles */
  var supportsHtml5Styles;

  /** Name of the expando, to work with multiple documents or to re-shiv one document */
  var expando = '_html5shiv';

  /** The id for the the documents expando */
  var expanID = 0;

  /** Cached data for each document */
  var expandoData = {};

  /** Detect whether the browser supports unknown elements */
  var supportsUnknownElements;

  (function() {
    try {
        var a = document.createElement('a');
        a.innerHTML = '<xyz></xyz>';
        //if the hidden property is implemented we can assume, that the browser supports basic HTML5 Styles
        supportsHtml5Styles = ('hidden' in a);

        supportsUnknownElements = a.childNodes.length == 1 || (function() {
          // assign a false positive if unable to shiv
          (document.createElement)('a');
          var frag = document.createDocumentFragment();
          return (
            typeof frag.cloneNode == 'undefined' ||
            typeof frag.createDocumentFragment == 'undefined' ||
            typeof frag.createElement == 'undefined'
          );
        }());
    } catch(e) {
      supportsHtml5Styles = true;
      supportsUnknownElements = true;
    }

  }());

  /*--------------------------------------------------------------------------*/

  /**
   * Creates a style sheet with the given CSS text and adds it to the document.
   * @private
   * @param {Document} ownerDocument The document.
   * @param {String} cssText The CSS text.
   * @returns {StyleSheet} The style element.
   */
  function addStyleSheet(ownerDocument, cssText) {
    var p = ownerDocument.createElement('p'),
        parent = ownerDocument.getElementsByTagName('head')[0] || ownerDocument.documentElement;

    p.innerHTML = 'x<style>' + cssText + '</style>';
    return parent.insertBefore(p.lastChild, parent.firstChild);
  }

  /**
   * Returns the value of `html5.elements` as an array.
   * @private
   * @returns {Array} An array of shived element node names.
   */
  function getElements() {
    var elements = html5.elements;
    return typeof elements == 'string' ? elements.split(' ') : elements;
  }
  
    /**
   * Returns the data associated to the given document
   * @private
   * @param {Document} ownerDocument The document.
   * @returns {Object} An object of data.
   */
  function getExpandoData(ownerDocument) {
    var data = expandoData[ownerDocument[expando]];
    if (!data) {
        data = {};
        expanID++;
        ownerDocument[expando] = expanID;
        expandoData[expanID] = data;
    }
    return data;
  }

  /**
   * returns a shived element for the given nodeName and document
   * @memberOf html5
   * @param {String} nodeName name of the element
   * @param {Document} ownerDocument The context document.
   * @returns {Object} The shived element.
   */
  function createElement(nodeName, ownerDocument, data){
    if (!ownerDocument) {
        ownerDocument = document;
    }
    if(supportsUnknownElements){
        return ownerDocument.createElement(nodeName);
    }
    if (!data) {
        data = getExpandoData(ownerDocument);
    }
    var node;

    if (data.cache[nodeName]) {
        node = data.cache[nodeName].cloneNode();
    } else if (saveClones.test(nodeName)) {
        node = (data.cache[nodeName] = data.createElem(nodeName)).cloneNode();
    } else {
        node = data.createElem(nodeName);
    }

    // Avoid adding some elements to fragments in IE < 9 because
    // * Attributes like `name` or `type` cannot be set/changed once an element
    //   is inserted into a document/fragment
    // * Link elements with `src` attributes that are inaccessible, as with
    //   a 403 response, will cause the tab/window to crash
    // * Script elements appended to fragments will execute when their `src`
    //   or `text` property is set
    return node.canHaveChildren && !reSkip.test(nodeName) ? data.frag.appendChild(node) : node;
  }

  /**
   * returns a shived DocumentFragment for the given document
   * @memberOf html5
   * @param {Document} ownerDocument The context document.
   * @returns {Object} The shived DocumentFragment.
   */
  function createDocumentFragment(ownerDocument, data){
    if (!ownerDocument) {
        ownerDocument = document;
    }
    if(supportsUnknownElements){
        return ownerDocument.createDocumentFragment();
    }
    data = data || getExpandoData(ownerDocument);
    var clone = data.frag.cloneNode(),
        i = 0,
        elems = getElements(),
        l = elems.length;
    for(;i<l;i++){
        clone.createElement(elems[i]);
    }
    return clone;
  }

  /**
   * Shivs the `createElement` and `createDocumentFragment` methods of the document.
   * @private
   * @param {Document|DocumentFragment} ownerDocument The document.
   * @param {Object} data of the document.
   */
  function shivMethods(ownerDocument, data) {
    if (!data.cache) {
        data.cache = {};
        data.createElem = ownerDocument.createElement;
        data.createFrag = ownerDocument.createDocumentFragment;
        data.frag = data.createFrag();
    }


    ownerDocument.createElement = function(nodeName) {
      //abort shiv
      if (!html5.shivMethods) {
          return data.createElem(nodeName);
      }
      return createElement(nodeName, ownerDocument, data);
    };

    ownerDocument.createDocumentFragment = Function('h,f', 'return function(){' +
      'var n=f.cloneNode(),c=n.createElement;' +
      'h.shivMethods&&(' +
        // unroll the `createElement` calls
        getElements().join().replace(/\w+/g, function(nodeName) {
          data.createElem(nodeName);
          data.frag.createElement(nodeName);
          return 'c("' + nodeName + '")';
        }) +
      ');return n}'
    )(html5, data.frag);
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Shivs the given document.
   * @memberOf html5
   * @param {Document} ownerDocument The document to shiv.
   * @returns {Document} The shived document.
   */
  function shivDocument(ownerDocument) {
    if (!ownerDocument) {
        ownerDocument = document;
    }
    var data = getExpandoData(ownerDocument);

    if (html5.shivCSS && !supportsHtml5Styles && !data.hasCSS) {
      data.hasCSS = !!addStyleSheet(ownerDocument,
        // corrects block display not defined in IE6/7/8/9
        'article,aside,figcaption,figure,footer,header,hgroup,nav,section{display:block}' +
        // adds styling not present in IE6/7/8/9
        'mark{background:#FF0;color:#000}'
      );
    }
    if (!supportsUnknownElements) {
      shivMethods(ownerDocument, data);
    }
    return ownerDocument;
  }

  /*--------------------------------------------------------------------------*/

  /**
   * The `html5` object is exposed so that more elements can be shived and
   * existing shiving can be detected on iframes.
   * @type Object
   * @example
   *
   * // options can be changed before the script is included
   * html5 = { 'elements': 'mark section', 'shivCSS': false, 'shivMethods': false };
   */
  var html5 = {

    /**
     * An array or space separated string of node names of the elements to shiv.
     * @memberOf html5
     * @type Array|String
     */
    'elements': options.elements || 'abbr article aside audio bdi canvas data datalist details figcaption figure footer header hgroup mark meter nav output progress section summary time video',

    /**
     * A flag to indicate that the HTML5 style sheet should be inserted.
     * @memberOf html5
     * @type Boolean
     */
    'shivCSS': (options.shivCSS !== false),

    /**
     * Is equal to true if a browser supports creating unknown/HTML5 elements
     * @memberOf html5
     * @type boolean
     */
    'supportsUnknownElements': supportsUnknownElements,

    /**
     * A flag to indicate that the document's `createElement` and `createDocumentFragment`
     * methods should be overwritten.
     * @memberOf html5
     * @type Boolean
     */
    'shivMethods': (options.shivMethods !== false),

    /**
     * A string to describe the type of `html5` object ("default" or "default print").
     * @memberOf html5
     * @type String
     */
    'type': 'default',

    // shivs the document according to the specified `html5` object options
    'shivDocument': shivDocument,

    //creates a shived element
    createElement: createElement,

    //creates a shived documentFragment
    createDocumentFragment: createDocumentFragment
  };

  /*--------------------------------------------------------------------------*/

  // expose html5
  window.html5 = html5;

  // shiv the document
  shivDocument(document);

}(this, document));


define('html5shiv', function(require, exports, module) {
module.exports = null;
});


window.html5shiv = require('html5shiv');

// es5-shim
// vim: ts=4 sts=4 sw=4 expandtab
// -- kriskowal Kris Kowal Copyright (C) 2009-2011 MIT License
// -- tlrobinson Tom Robinson Copyright (C) 2009-2010 MIT License (Narwhal Project)
// -- dantman Daniel Friesen Copyright (C) 2010 XXX TODO License or CLA
// -- fschaefer Florian Schäfer Copyright (C) 2010 MIT License
// -- Gozala Irakli Gozalishvili Copyright (C) 2010 MIT License
// -- kitcambridge Kit Cambridge Copyright (C) 2011 MIT License
// -- kossnocorp Sasha Koss XXX TODO License or CLA
// -- bryanforbes Bryan Forbes XXX TODO License or CLA
// -- killdream Quildreen Motta Copyright (C) 2011 MIT Licence
// -- michaelficarra Michael Ficarra Copyright (C) 2011 3-clause BSD License
// -- sharkbrainguy Gerard Paapu Copyright (C) 2011 MIT License
// -- bbqsrc Brendan Molloy (C) 2011 Creative Commons Zero (public domain)
// -- iwyg XXX TODO License or CLA
// -- DomenicDenicola Domenic Denicola Copyright (C) 2011 MIT License
// -- xavierm02 Montillet Xavier Copyright (C) 2011 MIT License
// -- Raynos Jake Verbaten Copyright (C) 2011 MIT Licence
// -- samsonjs Sami Samhuri Copyright (C) 2010 MIT License
// -- rwldrn Rick Waldron Copyright (C) 2011 MIT License
// -- lexer Alexey Zakharov XXX TODO License or CLA

/*!
    Copyright (c) 2009, 280 North Inc. http://280north.com/
    MIT License. http://github.com/280north/narwhal/blob/master/README.md
*/

// Module systems magic dance
(function (definition) {
    // RequireJS
    if (typeof define == "function" && (define.amd !== undefined)) {
        define(definition);
    // YUI3
    } else if (typeof YUI == "function") {
        YUI.add("es5", definition);
    // CommonJS and <script>
    } else {
        definition();
    }
})(function () {

/**
 * Brings an environment as close to ECMAScript 5 compliance
 * as is possible with the facilities of erstwhile engines.
 *
 * Annotated ES5: http://es5.github.com/ (specific links below)
 * ES5 Spec: http://www.ecma-international.org/publications/files/ECMA-ST/Ecma-262.pdf
 * Required reading: http://javascriptweblog.wordpress.com/2011/12/05/extending-javascript-natives/
 */

//
// Function
// ========
//

// ES-5 15.3.4.5
// http://es5.github.com/#x15.3.4.5

if (!Function.prototype.bind) {
    Function.prototype.bind = function bind(that) { // .length is 1
        // 1. Let Target be the this value.
        var target = this;
        // 2. If IsCallable(Target) is false, throw a TypeError exception.
        if (typeof target != "function") {
            throw new TypeError("Function.prototype.bind called on incompatible " + target);
        }
        // 3. Let A be a new (possibly empty) internal list of all of the
        //   argument values provided after thisArg (arg1, arg2 etc), in order.
        // XXX slicedArgs will stand in for "A" if used
        var args = slice.call(arguments, 1); // for normal call
        // 4. Let F be a new native ECMAScript object.
        // 11. Set the [[Prototype]] internal property of F to the standard
        //   built-in Function prototype object as specified in 15.3.3.1.
        // 12. Set the [[Call]] internal property of F as described in
        //   15.3.4.5.1.
        // 13. Set the [[Construct]] internal property of F as described in
        //   15.3.4.5.2.
        // 14. Set the [[HasInstance]] internal property of F as described in
        //   15.3.4.5.3.
        var bound = function () {

            if (this instanceof bound) {
                // 15.3.4.5.2 [[Construct]]
                // When the [[Construct]] internal method of a function object,
                // F that was created using the bind function is called with a
                // list of arguments ExtraArgs, the following steps are taken:
                // 1. Let target be the value of F's [[TargetFunction]]
                //   internal property.
                // 2. If target has no [[Construct]] internal method, a
                //   TypeError exception is thrown.
                // 3. Let boundArgs be the value of F's [[BoundArgs]] internal
                //   property.
                // 4. Let args be a new list containing the same values as the
                //   list boundArgs in the same order followed by the same
                //   values as the list ExtraArgs in the same order.
                // 5. Return the result of calling the [[Construct]] internal
                //   method of target providing args as the arguments.

                var F = function(){};
                F.prototype = target.prototype;
                var self = new F;

                var result = target.apply(
                    self,
                    args.concat(slice.call(arguments))
                );
                if (Object(result) === result) {
                    return result;
                }
                return self;

            } else {
                // 15.3.4.5.1 [[Call]]
                // When the [[Call]] internal method of a function object, F,
                // which was created using the bind function is called with a
                // this value and a list of arguments ExtraArgs, the following
                // steps are taken:
                // 1. Let boundArgs be the value of F's [[BoundArgs]] internal
                //   property.
                // 2. Let boundThis be the value of F's [[BoundThis]] internal
                //   property.
                // 3. Let target be the value of F's [[TargetFunction]] internal
                //   property.
                // 4. Let args be a new list containing the same values as the
                //   list boundArgs in the same order followed by the same
                //   values as the list ExtraArgs in the same order.
                // 5. Return the result of calling the [[Call]] internal method
                //   of target providing boundThis as the this value and
                //   providing args as the arguments.

                // equiv: target.call(this, ...boundArgs, ...args)
                return target.apply(
                    that,
                    args.concat(slice.call(arguments))
                );

            }

        };
        // XXX bound.length is never writable, so don't even try
        //
        // 15. If the [[Class]] internal property of Target is "Function", then
        //     a. Let L be the length property of Target minus the length of A.
        //     b. Set the length own property of F to either 0 or L, whichever is
        //       larger.
        // 16. Else set the length own property of F to 0.
        // 17. Set the attributes of the length own property of F to the values
        //   specified in 15.3.5.1.

        // TODO
        // 18. Set the [[Extensible]] internal property of F to true.

        // TODO
        // 19. Let thrower be the [[ThrowTypeError]] function Object (13.2.3).
        // 20. Call the [[DefineOwnProperty]] internal method of F with
        //   arguments "caller", PropertyDescriptor {[[Get]]: thrower, [[Set]]:
        //   thrower, [[Enumerable]]: false, [[Configurable]]: false}, and
        //   false.
        // 21. Call the [[DefineOwnProperty]] internal method of F with
        //   arguments "arguments", PropertyDescriptor {[[Get]]: thrower,
        //   [[Set]]: thrower, [[Enumerable]]: false, [[Configurable]]: false},
        //   and false.

        // TODO
        // NOTE Function objects created using Function.prototype.bind do not
        // have a prototype property or the [[Code]], [[FormalParameters]], and
        // [[Scope]] internal properties.
        // XXX can't delete prototype in pure-js.

        // 22. Return F.
        return bound;
    };
}

// Shortcut to an often accessed properties, in order to avoid multiple
// dereference that costs universally.
// _Please note: Shortcuts are defined after `Function.prototype.bind` as we
// us it in defining shortcuts.
var call = Function.prototype.call;
var prototypeOfArray = Array.prototype;
var prototypeOfObject = Object.prototype;
var slice = prototypeOfArray.slice;
// Having a toString local variable name breaks in Opera so use _toString.
var _toString = call.bind(prototypeOfObject.toString);
var owns = call.bind(prototypeOfObject.hasOwnProperty);

// If JS engine supports accessors creating shortcuts.
var defineGetter;
var defineSetter;
var lookupGetter;
var lookupSetter;
var supportsAccessors;
if ((supportsAccessors = owns(prototypeOfObject, "__defineGetter__"))) {
    defineGetter = call.bind(prototypeOfObject.__defineGetter__);
    defineSetter = call.bind(prototypeOfObject.__defineSetter__);
    lookupGetter = call.bind(prototypeOfObject.__lookupGetter__);
    lookupSetter = call.bind(prototypeOfObject.__lookupSetter__);
}

//
// Array
// =====
//

// ES5 15.4.3.2
// http://es5.github.com/#x15.4.3.2
// https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/isArray
if (!Array.isArray) {
    Array.isArray = function isArray(obj) {
        return _toString(obj) == "[object Array]";
    };
}

// The IsCallable() check in the Array functions
// has been replaced with a strict check on the
// internal class of the object to trap cases where
// the provided function was actually a regular
// expression literal, which in V8 and
// JavaScriptCore is a typeof "function".  Only in
// V8 are regular expression literals permitted as
// reduce parameters, so it is desirable in the
// general case for the shim to match the more
// strict and common behavior of rejecting regular
// expressions.

// ES5 15.4.4.18
// http://es5.github.com/#x15.4.4.18
// https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/array/forEach
if (!Array.prototype.forEach) {
    Array.prototype.forEach = function forEach(fun /*, thisp*/) {
        var self = toObject(this),
            thisp = arguments[1],
            i = -1,
            length = self.length >>> 0;

        // If no callback function or if callback is not a callable function
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(); // TODO message
        }

        while (++i < length) {
            if (i in self) {
                // Invoke the callback function with call, passing arguments:
                // context, property value, property key, thisArg object context
                fun.call(thisp, self[i], i, self);
            }
        }
    };
}

// ES5 15.4.4.19
// http://es5.github.com/#x15.4.4.19
// https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/map
if (!Array.prototype.map) {
    Array.prototype.map = function map(fun /*, thisp*/) {
        var self = toObject(this),
            length = self.length >>> 0,
            result = Array(length),
            thisp = arguments[1];

        // If no callback function or if callback is not a callable function
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self)
                result[i] = fun.call(thisp, self[i], i, self);
        }
        return result;
    };
}

// ES5 15.4.4.20
// http://es5.github.com/#x15.4.4.20
// https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/filter
if (!Array.prototype.filter) {
    Array.prototype.filter = function filter(fun /*, thisp */) {
        var self = toObject(this),
            length = self.length >>> 0,
            result = [],
            value,
            thisp = arguments[1];

        // If no callback function or if callback is not a callable function
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self) {
                value = self[i];
                if (fun.call(thisp, value, i, self)) {
                    result.push(value);
                }
            }
        }
        return result;
    };
}

// ES5 15.4.4.16
// http://es5.github.com/#x15.4.4.16
// https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/every
if (!Array.prototype.every) {
    Array.prototype.every = function every(fun /*, thisp */) {
        var self = toObject(this),
            length = self.length >>> 0,
            thisp = arguments[1];

        // If no callback function or if callback is not a callable function
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self && !fun.call(thisp, self[i], i, self)) {
                return false;
            }
        }
        return true;
    };
}

// ES5 15.4.4.17
// http://es5.github.com/#x15.4.4.17
// https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/some
if (!Array.prototype.some) {
    Array.prototype.some = function some(fun /*, thisp */) {
        var self = toObject(this),
            length = self.length >>> 0,
            thisp = arguments[1];

        // If no callback function or if callback is not a callable function
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self && fun.call(thisp, self[i], i, self)) {
                return true;
            }
        }
        return false;
    };
}

// ES5 15.4.4.21
// http://es5.github.com/#x15.4.4.21
// https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/reduce
if (!Array.prototype.reduce) {
    Array.prototype.reduce = function reduce(fun /*, initial*/) {
        var self = toObject(this),
            length = self.length >>> 0;

        // If no callback function or if callback is not a callable function
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        // no value to return if no initial value and an empty array
        if (!length && arguments.length == 1) {
            throw new TypeError('reduce of empty array with no initial value');
        }

        var i = 0;
        var result;
        if (arguments.length >= 2) {
            result = arguments[1];
        } else {
            do {
                if (i in self) {
                    result = self[i++];
                    break;
                }

                // if array contains no values, no initial value to return
                if (++i >= length) {
                    throw new TypeError('reduce of empty array with no initial value');
                }
            } while (true);
        }

        for (; i < length; i++) {
            if (i in self) {
                result = fun.call(void 0, result, self[i], i, self);
            }
        }

        return result;
    };
}

// ES5 15.4.4.22
// http://es5.github.com/#x15.4.4.22
// https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/reduceRight
if (!Array.prototype.reduceRight) {
    Array.prototype.reduceRight = function reduceRight(fun /*, initial*/) {
        var self = toObject(this),
            length = self.length >>> 0;

        // If no callback function or if callback is not a callable function
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        // no value to return if no initial value, empty array
        if (!length && arguments.length == 1) {
            throw new TypeError('reduceRight of empty array with no initial value');
        }

        var result, i = length - 1;
        if (arguments.length >= 2) {
            result = arguments[1];
        } else {
            do {
                if (i in self) {
                    result = self[i--];
                    break;
                }

                // if array contains no values, no initial value to return
                if (--i < 0) {
                    throw new TypeError('reduceRight of empty array with no initial value');
                }
            } while (true);
        }

        do {
            if (i in this) {
                result = fun.call(void 0, result, self[i], i, self);
            }
        } while (i--);

        return result;
    };
}

// ES5 15.4.4.14
// http://es5.github.com/#x15.4.4.14
// https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/indexOf
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function indexOf(sought /*, fromIndex */ ) {
        var self = toObject(this),
            length = self.length >>> 0;

        if (!length) {
            return -1;
        }

        var i = 0;
        if (arguments.length > 1) {
            i = toInteger(arguments[1]);
        }

        // handle negative indices
        i = i >= 0 ? i : Math.max(0, length + i);
        for (; i < length; i++) {
            if (i in self && self[i] === sought) {
                return i;
            }
        }
        return -1;
    };
}

// ES5 15.4.4.15
// http://es5.github.com/#x15.4.4.15
// https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/lastIndexOf
if (!Array.prototype.lastIndexOf) {
    Array.prototype.lastIndexOf = function lastIndexOf(sought /*, fromIndex */) {
        var self = toObject(this),
            length = self.length >>> 0;

        if (!length) {
            return -1;
        }
        var i = length - 1;
        if (arguments.length > 1) {
            i = Math.min(i, toInteger(arguments[1]));
        }
        // handle negative indices
        i = i >= 0 ? i : length - Math.abs(i);
        for (; i >= 0; i--) {
            if (i in self && sought === self[i]) {
                return i;
            }
        }
        return -1;
    };
}

//
// Object
// ======
//

// ES5 15.2.3.2
// http://es5.github.com/#x15.2.3.2
if (!Object.getPrototypeOf) {
    // https://github.com/kriskowal/es5-shim/issues#issue/2
    // http://ejohn.org/blog/objectgetprototypeof/
    // recommended by fschaefer on github
    Object.getPrototypeOf = function getPrototypeOf(object) {
        return object.__proto__ || (
            object.constructor
                ? object.constructor.prototype
                : prototypeOfObject
        );
    };
}

// ES5 15.2.3.3
// http://es5.github.com/#x15.2.3.3
if (!Object.getOwnPropertyDescriptor) {
    var ERR_NON_OBJECT = "Object.getOwnPropertyDescriptor called on a non-object: ";

    Object.getOwnPropertyDescriptor = function getOwnPropertyDescriptor(object, property) {
        if ((typeof object != "object" && typeof object != "function") || object === null) {
            throw new TypeError(ERR_NON_OBJECT + object);
        }
        // If object does not owns property return undefined immediately.
        if (!owns(object, property)) {
            return;
        }

        // If object has a property then it's for sure both `enumerable` and
        // `configurable`.
        var descriptor =  { enumerable: true, configurable: true };

        // If JS engine supports accessor properties then property may be a
        // getter or setter.
        if (supportsAccessors) {
            // Unfortunately `__lookupGetter__` will return a getter even
            // if object has own non getter property along with a same named
            // inherited getter. To avoid misbehavior we temporary remove
            // `__proto__` so that `__lookupGetter__` will return getter only
            // if it's owned by an object.
            var prototype = object.__proto__;
            object.__proto__ = prototypeOfObject;

            var getter = lookupGetter(object, property);
            var setter = lookupSetter(object, property);

            // Once we have getter and setter we can put values back.
            object.__proto__ = prototype;

            if (getter || setter) {
                if (getter) {
                    descriptor.get = getter;
                }
                if (setter) {
                    descriptor.set = setter;
                }
                // If it was accessor property we're done and return here
                // in order to avoid adding `value` to the descriptor.
                return descriptor;
            }
        }

        // If we got this far we know that object has an own property that is
        // not an accessor so we set it as a value and return descriptor.
        descriptor.value = object[property];
        return descriptor;
    };
}

// ES5 15.2.3.4
// http://es5.github.com/#x15.2.3.4
if (!Object.getOwnPropertyNames) {
    Object.getOwnPropertyNames = function getOwnPropertyNames(object) {
        return Object.keys(object);
    };
}

// ES5 15.2.3.5
// http://es5.github.com/#x15.2.3.5
if (!Object.create) {
    Object.create = function create(prototype, properties) {
        var object;
        if (prototype === null) {
            object = { "__proto__": null };
        } else {
            if (typeof prototype != "object") {
                throw new TypeError("typeof prototype["+(typeof prototype)+"] != 'object'");
            }
            var Type = function () {};
            Type.prototype = prototype;
            object = new Type();
            // IE has no built-in implementation of `Object.getPrototypeOf`
            // neither `__proto__`, but this manually setting `__proto__` will
            // guarantee that `Object.getPrototypeOf` will work as expected with
            // objects created using `Object.create`
            object.__proto__ = prototype;
        }
        if (properties !== void 0) {
            Object.defineProperties(object, properties);
        }
        return object;
    };
}

// ES5 15.2.3.6
// http://es5.github.com/#x15.2.3.6

// Patch for WebKit and IE8 standard mode
// Designed by hax <hax.github.com>
// related issue: https://github.com/kriskowal/es5-shim/issues#issue/5
// IE8 Reference:
//     http://msdn.microsoft.com/en-us/library/dd282900.aspx
//     http://msdn.microsoft.com/en-us/library/dd229916.aspx
// WebKit Bugs:
//     https://bugs.webkit.org/show_bug.cgi?id=36423

function doesDefinePropertyWork(object) {
    try {
        Object.defineProperty(object, "sentinel", {});
        return "sentinel" in object;
    } catch (exception) {
        // returns falsy
    }
}

// check whether defineProperty works if it's given. Otherwise,
// shim partially.
if (Object.defineProperty) {
    var definePropertyWorksOnObject = doesDefinePropertyWork({});
    var definePropertyWorksOnDom = typeof document == "undefined" ||
        doesDefinePropertyWork(document.createElement("div"));
    if (!definePropertyWorksOnObject || !definePropertyWorksOnDom) {
        var definePropertyFallback = Object.defineProperty;
    }
}

if (!Object.defineProperty || definePropertyFallback) {
    var ERR_NON_OBJECT_DESCRIPTOR = "Property description must be an object: ";
    var ERR_NON_OBJECT_TARGET = "Object.defineProperty called on non-object: "
    var ERR_ACCESSORS_NOT_SUPPORTED = "getters & setters can not be defined " +
                                      "on this javascript engine";

    Object.defineProperty = function defineProperty(object, property, descriptor) {
        if ((typeof object != "object" && typeof object != "function") || object === null) {
            throw new TypeError(ERR_NON_OBJECT_TARGET + object);
        }
        if ((typeof descriptor != "object" && typeof descriptor != "function") || descriptor === null) {
            throw new TypeError(ERR_NON_OBJECT_DESCRIPTOR + descriptor);
        }
        // make a valiant attempt to use the real defineProperty
        // for I8's DOM elements.
        if (definePropertyFallback) {
            try {
                return definePropertyFallback.call(Object, object, property, descriptor);
            } catch (exception) {
                // try the shim if the real one doesn't work
            }
        }

        // If it's a data property.
        if (owns(descriptor, "value")) {
            // fail silently if "writable", "enumerable", or "configurable"
            // are requested but not supported
            /*
            // alternate approach:
            if ( // can't implement these features; allow false but not true
                !(owns(descriptor, "writable") ? descriptor.writable : true) ||
                !(owns(descriptor, "enumerable") ? descriptor.enumerable : true) ||
                !(owns(descriptor, "configurable") ? descriptor.configurable : true)
            )
                throw new RangeError(
                    "This implementation of Object.defineProperty does not " +
                    "support configurable, enumerable, or writable."
                );
            */

            if (supportsAccessors && (lookupGetter(object, property) ||
                                      lookupSetter(object, property)))
            {
                // As accessors are supported only on engines implementing
                // `__proto__` we can safely override `__proto__` while defining
                // a property to make sure that we don't hit an inherited
                // accessor.
                var prototype = object.__proto__;
                object.__proto__ = prototypeOfObject;
                // Deleting a property anyway since getter / setter may be
                // defined on object itself.
                delete object[property];
                object[property] = descriptor.value;
                // Setting original `__proto__` back now.
                object.__proto__ = prototype;
            } else {
                object[property] = descriptor.value;
            }
        } else {
            if (!supportsAccessors) {
                throw new TypeError(ERR_ACCESSORS_NOT_SUPPORTED);
            }
            // If we got that far then getters and setters can be defined !!
            if (owns(descriptor, "get")) {
                defineGetter(object, property, descriptor.get);
            }
            if (owns(descriptor, "set")) {
                defineSetter(object, property, descriptor.set);
            }
        }
        return object;
    };
}

// ES5 15.2.3.7
// http://es5.github.com/#x15.2.3.7
if (!Object.defineProperties) {
    Object.defineProperties = function defineProperties(object, properties) {
        for (var property in properties) {
            if (owns(properties, property) && property != "__proto__") {
                Object.defineProperty(object, property, properties[property]);
            }
        }
        return object;
    };
}

// ES5 15.2.3.8
// http://es5.github.com/#x15.2.3.8
if (!Object.seal) {
    Object.seal = function seal(object) {
        // this is misleading and breaks feature-detection, but
        // allows "securable" code to "gracefully" degrade to working
        // but insecure code.
        return object;
    };
}

// ES5 15.2.3.9
// http://es5.github.com/#x15.2.3.9
if (!Object.freeze) {
    Object.freeze = function freeze(object) {
        // this is misleading and breaks feature-detection, but
        // allows "securable" code to "gracefully" degrade to working
        // but insecure code.
        return object;
    };
}

// detect a Rhino bug and patch it
try {
    Object.freeze(function () {});
} catch (exception) {
    Object.freeze = (function freeze(freezeObject) {
        return function freeze(object) {
            if (typeof object == "function") {
                return object;
            } else {
                return freezeObject(object);
            }
        };
    })(Object.freeze);
}

// ES5 15.2.3.10
// http://es5.github.com/#x15.2.3.10
if (!Object.preventExtensions) {
    Object.preventExtensions = function preventExtensions(object) {
        // this is misleading and breaks feature-detection, but
        // allows "securable" code to "gracefully" degrade to working
        // but insecure code.
        return object;
    };
}

// ES5 15.2.3.11
// http://es5.github.com/#x15.2.3.11
if (!Object.isSealed) {
    Object.isSealed = function isSealed(object) {
        return false;
    };
}

// ES5 15.2.3.12
// http://es5.github.com/#x15.2.3.12
if (!Object.isFrozen) {
    Object.isFrozen = function isFrozen(object) {
        return false;
    };
}

// ES5 15.2.3.13
// http://es5.github.com/#x15.2.3.13
if (!Object.isExtensible) {
    Object.isExtensible = function isExtensible(object) {
        // 1. If Type(O) is not Object throw a TypeError exception.
        if (Object(object) !== object) {
            throw new TypeError(); // TODO message
        }
        // 2. Return the Boolean value of the [[Extensible]] internal property of O.
        var name = '';
        while (owns(object, name)) {
            name += '?';
        }
        object[name] = true;
        var returnValue = owns(object, name);
        delete object[name];
        return returnValue;
    };
}

// ES5 15.2.3.14
// http://es5.github.com/#x15.2.3.14
if (!Object.keys) {
    // http://whattheheadsaid.com/2010/10/a-safer-object-keys-compatibility-implementation
    var hasDontEnumBug = true,
        dontEnums = [
            "toString",
            "toLocaleString",
            "valueOf",
            "hasOwnProperty",
            "isPrototypeOf",
            "propertyIsEnumerable",
            "constructor"
        ],
        dontEnumsLength = dontEnums.length;

    for (var key in {"toString": null}) {
        hasDontEnumBug = false;
    }

    Object.keys = function keys(object) {

        if ((typeof object != "object" && typeof object != "function") || object === null) {
            throw new TypeError("Object.keys called on a non-object");
        }

        var keys = [];
        for (var name in object) {
            if (owns(object, name)) {
                keys.push(name);
            }
        }

        if (hasDontEnumBug) {
            for (var i = 0, ii = dontEnumsLength; i < ii; i++) {
                var dontEnum = dontEnums[i];
                if (owns(object, dontEnum)) {
                    keys.push(dontEnum);
                }
            }
        }
        return keys;
    };

}

//
// Date
// ====
//

// ES5 15.9.5.43
// http://es5.github.com/#x15.9.5.43
// This function returns a String value represent the instance in time
// represented by this Date object. The format of the String is the Date Time
// string format defined in 15.9.1.15. All fields are present in the String.
// The time zone is always UTC, denoted by the suffix Z. If the time value of
// this object is not a finite Number a RangeError exception is thrown.
if (!Date.prototype.toISOString || (new Date(-62198755200000).toISOString().indexOf('-000001') === -1)) {
    Date.prototype.toISOString = function toISOString() {
        var result, length, value, year;
        if (!isFinite(this)) {
            throw new RangeError("Date.prototype.toISOString called on non-finite value.");
        }

        // the date time string format is specified in 15.9.1.15.
        result = [this.getUTCMonth() + 1, this.getUTCDate(),
            this.getUTCHours(), this.getUTCMinutes(), this.getUTCSeconds()];
        year = this.getUTCFullYear();
        year = (year < 0 ? '-' : (year > 9999 ? '+' : '')) + ('00000' + Math.abs(year)).slice(0 <= year && year <= 9999 ? -4 : -6);

        length = result.length;
        while (length--) {
            value = result[length];
            // pad months, days, hours, minutes, and seconds to have two digits.
            if (value < 10) {
                result[length] = "0" + value;
            }
        }
        // pad milliseconds to have three digits.
        return year + "-" + result.slice(0, 2).join("-") + "T" + result.slice(2).join(":") + "." +
            ("000" + this.getUTCMilliseconds()).slice(-3) + "Z";
    }
}

// ES5 15.9.4.4
// http://es5.github.com/#x15.9.4.4
if (!Date.now) {
    Date.now = function now() {
        return new Date().getTime();
    };
}

// ES5 15.9.5.44
// http://es5.github.com/#x15.9.5.44
// This function provides a String representation of a Date object for use by
// JSON.stringify (15.12.3).
if (!Date.prototype.toJSON) {
    Date.prototype.toJSON = function toJSON(key) {
        // When the toJSON method is called with argument key, the following
        // steps are taken:

        // 1.  Let O be the result of calling ToObject, giving it the this
        // value as its argument.
        // 2. Let tv be ToPrimitive(O, hint Number).
        // 3. If tv is a Number and is not finite, return null.
        // XXX
        // 4. Let toISO be the result of calling the [[Get]] internal method of
        // O with argument "toISOString".
        // 5. If IsCallable(toISO) is false, throw a TypeError exception.
        if (typeof this.toISOString != "function") {
            throw new TypeError('toISOString property is not callable');
        }
        // 6. Return the result of calling the [[Call]] internal method of
        //  toISO with O as the this value and an empty argument list.
        return this.toISOString();

        // NOTE 1 The argument is ignored.

        // NOTE 2 The toJSON function is intentionally generic; it does not
        // require that its this value be a Date object. Therefore, it can be
        // transferred to other kinds of objects for use as a method. However,
        // it does require that any such object have a toISOString method. An
        // object is free to use the argument key to filter its
        // stringification.
    };
}

// ES5 15.9.4.2
// http://es5.github.com/#x15.9.4.2
// based on work shared by Daniel Friesen (dantman)
// http://gist.github.com/303249
if (!Date.parse || Date.parse("+275760-09-13T00:00:00.000Z") !== 8.64e15) {
    // XXX global assignment won't work in embeddings that use
    // an alternate object for the context.
    Date = (function(NativeDate) {

        // Date.length === 7
        var Date = function Date(Y, M, D, h, m, s, ms) {
            var length = arguments.length;
            if (this instanceof NativeDate) {
                var date = length == 1 && String(Y) === Y ? // isString(Y)
                    // We explicitly pass it through parse:
                    new NativeDate(Date.parse(Y)) :
                    // We have to manually make calls depending on argument
                    // length here
                    length >= 7 ? new NativeDate(Y, M, D, h, m, s, ms) :
                    length >= 6 ? new NativeDate(Y, M, D, h, m, s) :
                    length >= 5 ? new NativeDate(Y, M, D, h, m) :
                    length >= 4 ? new NativeDate(Y, M, D, h) :
                    length >= 3 ? new NativeDate(Y, M, D) :
                    length >= 2 ? new NativeDate(Y, M) :
                    length >= 1 ? new NativeDate(Y) :
                                  new NativeDate();
                // Prevent mixups with unfixed Date object
                date.constructor = Date;
                return date;
            }
            return NativeDate.apply(this, arguments);
        };

        // 15.9.1.15 Date Time String Format.
        var isoDateExpression = new RegExp("^" +
            "(\\d{4}|[\+\-]\\d{6})" + // four-digit year capture or sign + 6-digit extended year
            "(?:-(\\d{2})" + // optional month capture
            "(?:-(\\d{2})" + // optional day capture
            "(?:" + // capture hours:minutes:seconds.milliseconds
                "T(\\d{2})" + // hours capture
                ":(\\d{2})" + // minutes capture
                "(?:" + // optional :seconds.milliseconds
                    ":(\\d{2})" + // seconds capture
                    "(?:\\.(\\d{3}))?" + // milliseconds capture
                ")?" +
            "(?:" + // capture UTC offset component
                "Z|" + // UTC capture
                "(?:" + // offset specifier +/-hours:minutes
                    "([-+])" + // sign capture
                    "(\\d{2})" + // hours offset capture
                    ":(\\d{2})" + // minutes offset capture
                ")" +
            ")?)?)?)?" +
        "$");

        // Copy any custom methods a 3rd party library may have added
        for (var key in NativeDate) {
            Date[key] = NativeDate[key];
        }

        // Copy "native" methods explicitly; they may be non-enumerable
        Date.now = NativeDate.now;
        Date.UTC = NativeDate.UTC;
        Date.prototype = NativeDate.prototype;
        Date.prototype.constructor = Date;

        // Upgrade Date.parse to handle simplified ISO 8601 strings
        Date.parse = function parse(string) {
            var match = isoDateExpression.exec(string);
            if (match) {
                match.shift(); // kill match[0], the full match
                // parse months, days, hours, minutes, seconds, and milliseconds
                for (var i = 1; i < 7; i++) {
                    // provide default values if necessary
                    match[i] = +(match[i] || (i < 3 ? 1 : 0));
                    // match[1] is the month. Months are 0-11 in JavaScript
                    // `Date` objects, but 1-12 in ISO notation, so we
                    // decrement.
                    if (i == 1) {
                        match[i]--;
                    }
                }

                // parse the UTC offset component
                var minuteOffset = +match.pop(), hourOffset = +match.pop(), sign = match.pop();

                // compute the explicit time zone offset if specified
                var offset = 0;
                if (sign) {
                    // detect invalid offsets and return early
                    if (hourOffset > 23 || minuteOffset > 59) {
                        return NaN;
                    }

                    // express the provided time zone offset in minutes. The offset is
                    // negative for time zones west of UTC; positive otherwise.
                    offset = (hourOffset * 60 + minuteOffset) * 6e4 * (sign == "+" ? -1 : 1);
                }

                // Date.UTC for years between 0 and 99 converts year to 1900 + year
                // The Gregorian calendar has a 400-year cycle, so
                // to Date.UTC(year + 400, .... ) - 12622780800000 == Date.UTC(year, ...),
                // where 12622780800000 - number of milliseconds in Gregorian calendar 400 years
                var year = +match[0];
                if (0 <= year && year <= 99) {
                    match[0] = year + 400;
                    return NativeDate.UTC.apply(this, match) + offset - 12622780800000;
                }

                // compute a new UTC date value, accounting for the optional offset
                return NativeDate.UTC.apply(this, match) + offset;
            }
            return NativeDate.parse.apply(this, arguments);
        };

        return Date;
    })(Date);
}

//
// String
// ======
//

// ES5 15.5.4.20
// http://es5.github.com/#x15.5.4.20
var ws = "\x09\x0A\x0B\x0C\x0D\x20\xA0\u1680\u180E\u2000\u2001\u2002\u2003" +
    "\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028" +
    "\u2029\uFEFF";
if (!String.prototype.trim || ws.trim()) {
    // http://blog.stevenlevithan.com/archives/faster-trim-javascript
    // http://perfectionkills.com/whitespace-deviations/
    ws = "[" + ws + "]";
    var trimBeginRegexp = new RegExp("^" + ws + ws + "*"),
        trimEndRegexp = new RegExp(ws + ws + "*$");
    String.prototype.trim = function trim() {
        if (this === undefined || this === null) {
            throw new TypeError("can't convert "+this+" to object");
        }
        return String(this).replace(trimBeginRegexp, "").replace(trimEndRegexp, "");
    };
}

//
// Util
// ======
//

// ES5 9.4
// http://es5.github.com/#x9.4
// http://jsperf.com/to-integer
var toInteger = function (n) {
    n = +n;
    if (n !== n) { // isNaN
        n = 0;
    } else if (n !== 0 && n !== (1/0) && n !== -(1/0)) {
        n = (n > 0 || -1) * Math.floor(Math.abs(n));
    }
    return n;
};

var prepareString = "a"[0] != "a";
    // ES5 9.9
    // http://es5.github.com/#x9.9
var toObject = function (o) {
    if (o == null) { // this matches both null and undefined
        throw new TypeError("can't convert "+o+" to object");
    }
    // If the implementation doesn't support by-index access of
    // string characters (ex. IE < 9), split the string
    if (prepareString && typeof o == "string" && o) {
        return o.split("");
    }
    return Object(o);
};
});



// We've added this file as there is a bug in IE8 in the current version of this shim (2.0.2)
// "i in self" fails.

if((navigator.appName == 'Microsoft Internet Explorer') && (navigator.userAgent.match(/MSIE ([0-9]+)/)[1] <= 8))
	{
	var prepareString = "a"[0] != "a"; 
	Array.prototype.indexOf = function indexOf(sought /*, fromIndex */ ) {
	    var self = toObject(this),
	        length = self.length >>> 0;
	
	    if (!length) {
	        return -1;
	    }
	
	    var i = 0;
	    if (arguments.length > 1) {
	        i = toInteger(arguments[1]);
	    }
	
	    // handle negative indices
	    i = i >= 0 ? i : Math.max(0, length + i);
	    for (; i < length; i++) {
	        if (self[i] === sought) { // Patch was this line
	            return i;
	        }
	    }
	    return -1;
	};
	
	//ES5 9.4
	//http://es5.github.com/#x9.4
	//http://jsperf.com/to-integer
	
	function toInteger(n) {
	 n = +n;
	 if (n !== n) { // isNaN
	     n = 0;
	 } else if (n !== 0 && n !== (1/0) && n !== -(1/0)) {
	     n = (n > 0 || -1) * Math.floor(Math.abs(n));
	 }
	 return n;
	}
	
	//ES5 9.9
	//http://es5.github.com/#x9.9
	var toObject = function (o) {
	 if (o == null) { // this matches both null and undefined
	     throw new TypeError("can't convert "+o+" to object");
	 }
	 return Object(o);
	};
}

define('es5-shim', function(require, exports, module) {
module.exports = null;
});


window.es5_shim = require('es5-shim');

// br-shims
define('br-shims', function(require, exports, module) {
module.exports = null;
});


window.br_shims = require('br-shims');

// br-bootstrap
(function(window) {
	"use strict";

	/** @private */
	window.mergePackageBlock = function(context, packageBlock) {
		for (var packageName in packageBlock) {
			if(!context[packageName]) {
				context[packageName] = packageBlock[packageName];
			}
			else {
				mergePackageBlock(context[packageName], packageBlock[packageName]);
			}
		}
	}

	/** @private */
	window.requireAll = function(requirePaths) {
		for (var i = 0; i < requirePaths.length; i++) {
			var requirePath = requirePaths[i];
			var namespacePath = requirePath.replace(/\//gi, ".");
			mergePackageBlock( window, convertToPackageBlock(namespacePath) );
			globaliseRequirePath(requirePath, namespacePath);
		}
	}

	/* private stuff */

	var globaliseRequirePath = function(requirePath, namespacePath) {
		var namespacePathContext = getContextForNamespacePath(namespacePath);
		var namespaceKeyName = namespacePath.split(".").pop();
		namespacePathContext[namespaceKeyName] = require(requirePath);
	}

	var convertToPackageBlock = function(namespacePath) {
		var namespacePathParts = namespacePath.split(".");
		namespacePathParts.pop();
		var rootContext = {};
		var currentContext = rootContext;
		for (var i = 0; i < namespacePathParts.length; i++) {
			var namespacePathPart = namespacePathParts[i];
			currentContext[namespacePathPart] = {};
			currentContext = currentContext[namespacePathPart];
		}
		return rootContext;
	}

	var getContextForNamespacePath = function(namespacePath) {
		var namespacePathParts = namespacePath.split(".");
		namespacePathParts.pop();
		var currentContext = window;
		for (var i = 0; i < namespacePathParts.length; i++) {
			var namespacePathPart = namespacePathParts[i];
			currentContext = currentContext[namespacePathPart];
		}
		return currentContext;
	}

})(window);


define('br-bootstrap', function(require, exports, module) {
module.exports = {};
});


window.br_bootstrap = require('br-bootstrap');

// emitr
define('emitr', function(require, exports, module) {
// emitr built for browser 2014-04-22T15:17:19.614Z
;(function (name, factory) {
	if (typeof module === 'object') {
		// Does not work with strict CommonJS, but only CommonJS-like environments
		// that support module.exports - like Node.
		module.exports = factory();
	} else if (typeof define === 'function') {
		define(factory);
	} else {
		// For an environment with no require/define framework loaded - e.g. a browser.
		var global = Function("return this")();
		global[name] = factory();
	}
})
( "emitr", function() {
	var global = Function("return this")();
	
	function realm(parentRequire) {
		var moduleDefinitions = {}, incompleteExports = {}, moduleExports = {}, modulesFromParent = {};
	
		function derelativise(context, path) {
			var result = (context === "" || path.charAt(0) !== '.') ? [] : context.split("/");
			var working = path.split("/"), item;
			while (item = working.shift()) {
				if (item === "..") {
					result.pop();
				} else if (item !== ".") {
					result.push(item);
				}
			}
			return result.join("/");
		}
	
		function define(id, definition) {
			if (id in moduleDefinitions) {
				throw new Error('Module ' + id + ' has already been defined.');
			}
			if (modulesFromParent[id] === true) {
				throw new Error('Module ' + id + ' has already been loaded from a parent realm.');
			}
			moduleDefinitions[id] = definition;
		}
	
		function require(context, id) {
			id = derelativise(context, id).replace(/\.js$/, "");
	
			if (moduleExports[id] != null) { return moduleExports[id]; }
	
			if (incompleteExports[id] != null) {
				// there is a circular dependency, we do the best we can in the circumstances.
				return incompleteExports[id].exports;
			}
	
			var definition = moduleDefinitions[id];
			if (definition == null) {
				if (parentRequire != null) {
					var result = parentRequire(id);
					modulesFromParent[id] = true;
					return result;
				}
				throw new Error("No definition for module " + id + " has been loaded.");
			}
	
			var module = { exports: {}, id: id };
			incompleteExports[id] = module;
			try {
				if (typeof definition === 'function') {
					var definitionContext = id;
					var idx = id.lastIndexOf("/");
					if (idx >= 0) {
						definitionContext = id.substring(0, idx);
					}
					var returnValue = definition.call(module, require.bind(null, definitionContext), module.exports, module);
					moduleExports[id] = returnValue || module.exports;
				} else {
					moduleExports[id] = definition;
				}
			} finally {
				delete incompleteExports[id];
			}
			return moduleExports[id];
		}
	
		return {
			define: define, require: require.bind(null, '')
		};
	}
	
	var defaultRealm = realm(global.require || function(moduleId) {
		if (global[moduleId]) {
			return global[moduleId];
		}
		throw new Error("No definition for module " + moduleId + " could be found in the global top level.");
	});
	
	var require = defaultRealm.require;
	var _define = defaultRealm.define;

	_define("emitr", function(require, exports, module) {
		module.exports = require("./lib/index");
	});
	_define("emitr/lib/index", function(require, exports, module) {
		module.exports = require('./Emitter');
		module.exports.meta = require('./events');
		module.exports.Event = require('./Event');
	});
	_define("emitr/lib/Emitter", function(require, exports, module) {
		"use strict";
		
		var slice = Array.prototype.slice;
		
		var metaEvents = require('./events');
		var MultiMap = require('./MultiMap');
		
		var getPrototypeOf = require('./shams').getPrototypeOf;
		
		///////////////////////////////////////////////////////////////////////////
		var ONCE_FUNCTION_MARKER = {};
		
		function notify(listeners, args) {
			if (listeners.length === 0) { return false; }
			// take a copy in case one of the callbacks modifies the listeners array.
			listeners = listeners.slice();
			for (var i = 0, len = listeners.length; i < len; ++i) {
				var listener = listeners[i];
				listener.callback.apply(listener.context, args);
			}
			return true;
		}
		
		function notifyRemoves(emitter, listenerRecords) {
			for (var i = 0, len = listenerRecords.length; i < len; ++i) {
				var listenerRecord = listenerRecords[i];
				emitter.trigger(new metaEvents.RemoveListenerEvent(listenerRecord.eventIdentifier, listenerRecord.callback, listenerRecord.registeredContext));
			}
		}
		
		/**
		 * This constructor function can be used directly, but most commonly, you will
		 * call it from within your own constructor.
		 *
		 * e.g. <code>Emitter.call(this);</code>
		 *
		 * It will set up the emitter state if called, but it is optional.
		 *
		 * @constructor
		 * @class Emitter
		 * @classdesc
		 * Emitter provides event emitting capabilities, similar to Backbone.
		 * For more information see <a href="http://caplin.github.io/Emitter">the project page</a>.
		 */
		function Emitter() {
			this._emitterListeners = new MultiMap();
			this._emitterMetaEventsOn = false;
		};
		
		Emitter.prototype = {
			/**
			 * Registers a listener for an event.
			 *
			 * If context is provided, then the <code>this</code> pointer will refer to it
			 * inside the callback.
			 *
			 * @param {*} eventIdentifier The identifier of the event that the callback should listen to.
			 * @param {function} callback The function that should be called whenever the event is triggered.  May not be null.
			 * @param {?Object} [context] An optional context that defines what 'this' should be inside the callback.
			 */
			on: function listen(eventIdentifier, callback, context) {
				if (typeof callback !== 'function') { throw new TypeError("on: Illegal Argument: callback must be a function, was " + (typeof callback)); }
		
				// This allows us to work even if the constructor hasn't been called.  Useful for mixins.
				if (this._emitterListeners === undefined) {
					this._emitterListeners = new MultiMap();
				}
		
				if (typeof eventIdentifier === 'function' && (eventIdentifier.prototype instanceof metaEvents.MetaEvent || eventIdentifier === metaEvents.MetaEvent)) {
					// Since triggering meta events can be expensive, we only
					// do so if a listener has been added to listen to them.
					this._emitterMetaEventsOn = true;
				}
		
				var currentListeners = this._emitterListeners.getValues(eventIdentifier);
				currentListeners = currentListeners.filter(function(listenerRecord) {
					return listenerRecord.registeredContext === context
						&& (listenerRecord.callback === callback
							|| (listenerRecord.callback._wrappedCallback !== undefined
								&& listenerRecord.callback._wrappedCallback === callback._wrappedCallback));
				});
				if (currentListeners.length > 0) {
					throw new Error('This callback is already listening to this event.');
				}
		
				this._emitterListeners.add(eventIdentifier, {
					eventIdentifier: eventIdentifier,
					callback: callback,
					registeredContext: context,
					context: context !== undefined ? context : this
				});
		
				if (this._emitterMetaEventsOn === true) {
					this.trigger(new metaEvents.AddListenerEvent(eventIdentifier, callback._onceFunctionMarker === ONCE_FUNCTION_MARKER ? callback._wrappedCallback : callback, context));
				}
			},
		
			/**
			 * Registers a listener to receive an event only once.
			 *
			 * If context is provided, then the <code>this</code> pointer will refer to it
			 * inside the callback.
			 *
			 * @param {*} eventIdentifier The identifier of the event that the callback should listen to.
			 * @param {function} callback The function that should be called the first time the event is triggered.  May not be null.
			 * @param {?Object} [context] An optional context that defines what 'this' should be inside the callback.
			 */
			once: function(eventIdentifier, callback, context) {
				if (typeof callback !== 'function') { throw new TypeError("onnce: Illegal Argument: callback must be a function, was " + (typeof callback)); }
		
				var off = this.off.bind(this), hasFired = false;
		
				function onceEventHandler() {
					if (hasFired === false) {
						hasFired = true;
						off(eventIdentifier, onceEventHandler, context);
						callback.apply(this, arguments);
					}
				}
				// We need this to enable us to remove the wrapping event handler
				// when off is called with the original callback.
				onceEventHandler._onceFunctionMarker = ONCE_FUNCTION_MARKER;
				onceEventHandler._wrappedCallback = callback;
		
				this.on(eventIdentifier, onceEventHandler, context);
			},
		
			/**
			 * Clear previously registered listeners.
			 *
			 * With no arguments, this clears all listeners from this Emitter.
			 *
			 * With one argument, this clears all listeners registered to a particular event.
			 *
			 * With two or three arguments, this clears a specific listener.
			 *
			 * @param {?*} eventIdentifier The identifier of the event to clear. If null, it will clear all events.
			 * @param {?function} callback The callback function to clear.
			 * @param {?Object} context The context object for the callback.
			 * @returns {boolean} true if any listeners were removed.  This is not finalised yet and may change (particularly if we want to enable chaining).
			 */
			off: function off(eventIdentifier, callback, context) {
				// not initialised - so no listeners of any kind
				if (this._emitterListeners == null) { return false; }
		
				if (arguments.length === 0) {
					// clear all listeners.
					if (this._emitterMetaEventsOn === true) {
						var allListeners = this._emitterListeners.getValues();
						notifyRemoves(this, allListeners);
					}
					this._emitterListeners.clear();
					return true;
				} else if (arguments.length === 1) {
					// clear all listeners for a particular eventIdentifier.
					if (this._emitterListeners.hasAny(eventIdentifier)) {
						var listeners = this._emitterListeners.getValues(eventIdentifier);
						this._emitterListeners['delete'](eventIdentifier);
						if (this._emitterMetaEventsOn === true) {
							notifyRemoves(this, listeners);
						}
						return true;
					}
					return false;
				} else if (eventIdentifier === null && callback === null) {
					// clear all listeners for a particular context.
					return this.clearListeners(context);
				} else {
					// clear a specific listener.
					if (typeof callback !== 'function') { throw new TypeError("off: Illegal Argument: callback must be a function, was " + (typeof callback)); }
		
					var removedAListener = this._emitterListeners.removeLastMatch(eventIdentifier, function(record) {
						var callbackToCompare = record.callback._onceFunctionMarker === ONCE_FUNCTION_MARKER ? record.callback._wrappedCallback : record.callback;
						var callbackMatches = callback === callbackToCompare;
						var contextMatches = record.registeredContext === context;
						return callbackMatches && contextMatches;
					});
		
					if (removedAListener && this._emitterMetaEventsOn === true) {
						this.trigger(new metaEvents.RemoveListenerEvent(eventIdentifier, callback, context));
					}
					return removedAListener;
				}
			},
		
			/**
			 * Fires an event, causing all the listeners registered for this event to be called.
			 *
			 * If the event is an object, this will also call any listeners registered for
			 * its class or any superclasses will also fire.
			 *
			 * @param {*} event The event to fire.
			 * @param {...*} [args] Optional arguments to pass to the listeners.
			 * @returns {boolean} true if any listeners were notified, false otherwise.  This is not finalised and may change (particularly if we want to allow chaining).
			 */
			trigger: function trigger(event) {
				var args;
				var anyListeners = false;
				if (this._emitterListeners != null) {
					args = slice.call(arguments, 1);
					if (this._emitterListeners.hasAny(event)) {
						anyListeners = true;
						notify(this._emitterListeners.getValues(event), args);
					}
		
					// navigate up the prototype chain emitting against the constructors.
					if (typeof event === 'object') {
						var last = event, proto = getPrototypeOf(event);
						while (proto !== null && proto !== last) {
							if (this._emitterListeners.hasAny(proto.constructor)) {
								anyListeners = true;
								notify(this._emitterListeners.getValues(proto.constructor), arguments);
							}
							last = proto;
							proto = getPrototypeOf(proto);
						}
					}
				}
				if (this._emitterMetaEventsOn === true && anyListeners === false && event instanceof metaEvents.DeadEvent === false) {
					this.trigger(new metaEvents.DeadEvent(event, args));
				}
				return anyListeners;
			},
		
			/**
			 * Clears all listeners registered for a particular context.
			 *
			 * @param {Object} context The context that all listeners should be removed for.  May not be null.
			 */
			clearListeners: function clearListeners(context) {
				if (context == null) { throw new Error('clearListeners: context must be provided.'); }
				// notify for every listener we throw out.
				var removedListeners, trackRemovals = false;
				if (this._emitterMetaEventsOn === true) {
					trackRemovals = true;
					removedListeners = [];
				}
				this._emitterListeners.filterAll(function(record) {
					var keepListener = record.registeredContext !== context;
					if (trackRemovals && keepListener === false) {
						removedListeners.push(record);
					}
					return keepListener;
				});
				if (trackRemovals && removedListeners.length > 0) {
					notifyRemoves(this, removedListeners);
				}
			}
		};
		
		/**
		 * Copies the Emitter methods onto the provided object.
		 *
		 * If the passed destination is a function, it copies the methods
		 * onto the prototype of the passed destination.
		 *
		 * @param {function|Object} destination the object to copy the Emitter
		 *    methods to or the constructor that should have its prototype
		 *    augmented with the Emitter methods.
		 */
		Emitter.mixInto = function(destination) {
			if (typeof destination === 'function') {
				destination = destination.prototype;
			}
			for (var key in Emitter.prototype) {
				// If in the future Emitter is changed to inherit from something,
				// we would want to copy those methods/properties too.
				//noinspection JSUnfilteredForInLoop
				if (destination.hasOwnProperty(key)) {
					throw new Error("Emitter.mixInto: Destination already has function " + key + " unable to mixin.");
				}
				//noinspection JSUnfilteredForInLoop
				destination[key] = Emitter.prototype[key];
			}
		};
		
		module.exports = Emitter;
		
	});
	_define("emitr/lib/events", function(require, exports, module) {
		"use strict";
		
		var Event = require('./Event');
		
		var MetaEvent = Event.extend(
				/**
				 * @memberOf Emitter.meta
				 * @class MetaEvent
				 * @param {*} event The event this MetaEvent is about
				 * @classdesc
				 * A parent class for all meta events.
				 */
						function(event) {
					/**
					 * Event provides the identifier of the event that this MetaEvent is about.
					 * @name Emitter.meta.MetaEvent#event
					 * @type {*}
					 */
					this.event = event;
				}
		);
		/**
		 * @memberOf Emitter.meta
		 * @extends Emitter.meta.MetaEvent
		 * @class ListenerEvent
		 * @classdesc
		 * A parent class for all MetaEvents about listeners.
		 */
		var ListenerEvent = MetaEvent.extend(
				function(event, listener, context) {
					MetaEvent.call(this, event);
					/**
					 * The listener this ListenerEvent is about.
					 * @name Emitter.meta.ListenerEvent#listener
					 * @type {function}
					 */
					this.listener = listener;
					/**
					 * The context associated with the listener.
					 * @name Emitter.meta.ListenerEvent#context
					 * @type {?object}
					 */
					this.context = context;
				}
		);
		/**
		 * @memberOf Emitter.meta
		 * @class AddListenerEvent
		 * @extends Emitter.meta.ListenerEvent
		 */
		var AddListenerEvent = ListenerEvent.extend();
		/**
		 * @memberOf Emitter.meta
		 * @class RemoveListenerEvent
		 * @extends Emitter.meta.ListenerEvent
		 */
		var RemoveListenerEvent = ListenerEvent.extend();
		/**
		 * @memberOf Emitter.meta
		 * @class DeadEvent
		 * @extends Emitter.meta.MetaEvent
		 */
		var DeadEvent = MetaEvent.extend(
				function(event, args) {
					MetaEvent.call(this, event);
					this.data = args;
				}
		);
		
		/**
		 * Where the meta events live.
		 * @memberOf Emitter
		 * @namespace meta
		 */
		module.exports = {
			MetaEvent: MetaEvent,
			ListenerEvent: ListenerEvent,
			AddListenerEvent: AddListenerEvent,
			RemoveListenerEvent: RemoveListenerEvent,
			DeadEvent: DeadEvent
		};
		
	});
	_define("emitr/lib/Event", function(require, exports, module) {
		"use strict";
		
		var shams = require('./shams');
		// Event ///////////////////////////////////////////////////////////////////////////////////////////
		
		/**
		 * Creates a base Event object.
		 * @constructor
		 * @memberOf Emitter
		 * @class Event
		 * @classdesc
		 * Event provides a convenient base class for events.
		 */
		var Event = function() {};
		
		/**
		 * Extend provides a shorthand for creating subclasses of the class
		 * whose constructor it is attached to.
		 *
		 * You can pass in an object that represents the things that
		 * should be added to the prototype (in which case, the special
		 * member 'constructor' if present will become the constructor),
		 * or a function that represents the constructor whose prototype
		 * should be modified, or nothing at all, in which case a new
		 * constructor will be created that calls the superclass constructor.
		 *
		 * @memberOf Emitter.Event
		 * @param {object|function} [properties] an object containing methods to be added to the prototype, or the constructor function, or nothing at all.
		 * @returns {function} a constructor function for the newly created subclass.
		 */
		Event.extend = function inlineExtend(properties) {
			var superclass = this, subclassConstructor;
			if (typeof superclass !== 'function') { throw new TypeError("extend: Superclass must be a constructor function, was a " + typeof superclass); }
		
			if (typeof properties === 'function') {
				subclassConstructor = properties;
			} else if (properties != null && properties.hasOwnProperty('constructor')) {
				subclassConstructor = properties.constructor;
			} else {
				subclassConstructor = function() {
					superclass.apply(this, arguments);
				};
			}
			subclassConstructor.superclass = superclass;
			subclassConstructor.prototype = shams.create(superclass.prototype, {
				constructor: {
					enumerable: false, value: subclassConstructor
				}
			});
			
			//IE8 bug. https://developer.mozilla.org/en-US/docs/ECMAScript_DontEnum_attribute
			if (subclassConstructor.prototype.constructor !== subclassConstructor) {
				subclassConstructor.prototype.constructor = subclassConstructor;
			}
		
			if (typeof properties === 'object') {
				if (shams.getPrototypeOf(properties) !== Object.prototype) {
					throw new Error("extend: Can't extend something that already has a prototype chain.");
				}
				for (var instanceProperty in properties) {
					if (instanceProperty !== 'constructor' && properties.hasOwnProperty(instanceProperty)) {
						subclassConstructor.prototype[instanceProperty] = properties[instanceProperty];
					}
				}
			}
			for (var staticProperty in superclass) {
				if (superclass.hasOwnProperty(staticProperty)) {
					subclassConstructor[staticProperty] = superclass[staticProperty];
				}
			}
		
			return subclassConstructor;
		};
		/**
		 * A simple toString is provided to aid in debugging.
		 * @returns {string} a representation of all the fields on the object.
		 */
		Event.prototype.toString = function() {
			var result = [];
			for (var key in this) {
				// toString should show inherited properties too.
				//noinspection JSUnfilteredForInLoop
				if (typeof result[key] !== 'function') {
					//noinspection JSUnfilteredForInLoop
					result.push(key + ": " + this[key] + ",");
				}
			}
			return result.join(" ");
		};
		
		module.exports = Event;
	});
	_define("emitr/lib/shams", function(require, exports, module) {
		// Partial 'sham' to work around ie8s lack of es5 //////////////////////////////////////////////
		// When IE8 support is no longer needed, all these can be dropped in favour of the es5 methods.
		
		exports.getPrototypeOf = function getPrototypeOf(obj) {
			if (Object.getPrototypeOf) {
				var proto = Object.getPrototypeOf(obj);
		
				// to avoid bad shams...
				if (proto !== obj) return proto;
			}
		
			// this is what most shams do, but sometimes it's wrong.
			if (obj.constructor && obj.constructor.prototype && obj.constructor.prototype !== obj) {
				return obj.constructor.prototype;
			}
		
			// this works only if we've been kind enough to supply a superclass property
			// (which we do when we extend classes).
			if (obj.constructor && obj.constructor.superclass) {
				return obj.constructor.superclass.prototype;
			}
		
			// can't find a good prototype.
			return null;
		};
		
		var defineProperty = function(obj, prop, descriptor) {
			obj[prop] = descriptor.value;
		};
		if (Object.defineProperty) {
			try {
				// IE8 throws an error here.
				Object.defineProperty({}, 'x', {});
				defineProperty = Object.defineProperty;
			} catch (e) {}
		}
		exports.defineProperty = defineProperty;
		
		exports.create = function create(proto, descriptors) {
			var result;
		
			if(Object.create) {
				result = Object.create(proto, descriptors);
		
				var dunderProtoPassedIn = (proto && proto.__proto__) || (descriptors && descriptors.__proto__);
		
				if(result.__proto__ && !dunderProtoPassedIn) {
					//ES5 shim added this and it's a lie so delete it.
					delete result.__proto__;
				}
			} else {
				var myConstructor = function() {};
				myConstructor.prototype = proto;
		
				result = new myConstructor();
		
				var keys = Object.keys(descriptors);
				for (var i = 0; i < keys.length; ++i) {
					var key = keys[i];
					defineProperty(result, key, descriptors[key]);
				}
			}
		
			return result;
		};
		
	});
	_define("emitr/lib/MultiMap", function(require, exports, module) {
		var Map = require('./Map');
		
		function MultiMap() {
			this._map = new Map();
		}
		MultiMap.prototype = {
			'getValues': function getValues(key) {
				var val;
				if (arguments.length === 0) {
					// return all values for all keys.
					val = [];
					this._map.forEach(function(values) {
						val.push.apply(val, values);
					});
				} else {
					// return all the values for the provided key.
					val = this._map.get(key);
					if (val === undefined) {
						val = [];
						this._map.set(key, val);
					}
				}
				return val;
			},
			'clear': function clear() {
				this._map = new Map();
			},
			'add': function add(key, value) {
				this.getValues(key).push(value);
			},
			'filter': function filter(key, filterFunction) {
				if (this._map.has(key) === false) { return; }
				var values = this._map.get(key).filter(filterFunction);
		
				if (values.length === 0) {
					this._map['delete'](key);
				} else {
					this._map.set(key, values);
				}
			},
			'filterAll': function(filterFunction) {
				this._map.forEach(function(values, key, map) {
					var newValues = values.filter(filterFunction);
					if (newValues.length === 0) {
						map['delete'](key);
					} else {
						map.set(key, newValues);
					}
				});
			},
			'removeLastMatch': function removeLast(key, matchFunction) {
				if (this._map.has(key) === false) { return false; }
				var values = this._map.get(key);
				for (var i = values.length - 1; i >= 0; --i) {
					if (matchFunction(values[i])) {
						values.splice(i, 1);
						return true;
					}
				}
				return false;
			},
			'hasAny': function has(key) {
				return this._map.has(key);
			},
			'delete': function del(key) {
				this._map['delete'](key);
			}
		};
		
		module.exports = MultiMap;
	});
	_define("emitr/lib/Map", function(require, exports, module) {
		"use strict";
		
		var global = Function("return this")();
		
		var Map = global.Map;
		
		// Uses a map for string keys and two arrays for nonstring keys.
		// Another alternative would have been to add a nonenumerable id to everything that was set.
		function MapShim() {
			this._map = {};
			this._keys = [];
			this._values = [];
		}
		MapShim.prototype = {
			'set': function set(key, value) {
				if (typeof key === 'string') {
					this._map[key] = value;
					return value;
				}
				var idx = this._keys.indexOf(key);
				if (idx < 0) {
					idx = this._keys.length;
					this._keys[idx] = key;
				}
				this._values[idx] = value;
				return value;
			},
			'get': function get(key) {
				if (typeof key === 'string') {
					return this._map[key];
				}
				return this._values[this._keys.indexOf(key)];
			},
			'delete': function(key) {
				if (typeof key === 'string') {
					delete this._map[key];
					return;
				}
				var idx = this._keys.indexOf(key);
				if (idx >= 0) {
					this._keys.splice(idx, 1);
					this._values.splice(idx, 1);
				}
			},
			'has': function(key) {
				return (typeof key === 'string' && key in this._map) || (this._keys.indexOf(key) >= 0);
			},
			'forEach': function(callback) {
				for (var key in this._map) {
					if (this._map.hasOwnProperty(key)) {
						callback(this._map[key], key, this);
					}
				}
				for (var i = this._keys.length - 1; i >= 0; --i) {
					callback(this._values[i], this._keys[i], this);
				}
			}
		};
		
		// Older versions of Firefox had Map, but didn't have forEach, so we'll use the shim there too.
		if (Map === undefined || Map.prototype.forEach === undefined) {
			Map = MapShim;
		}
		
		module.exports = Map;
	});
	

	return require("emitr");
});


});


window.emitr = require('emitr');

// topiarist
define('topiarist', function(require, exports, module) {
/**
 * @namespace
 * The topiarist namespace contains a number of functions for
 * creating and querying a class hierarchy.
 * @name topiarist
 */
;(function (definition) {
	// export mechanism that works in node, browser and some other places.
	if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
		// node style commonJS.
		module.exports = definition();
	} else if (typeof define === "function") {
		if (define.amd) {
			define(definition);
		} else {
			define('topiarist', definition);
		}
	} else {
		// setting a global, as in e.g. a browser.
		this.topiarist = definition();
	}
})(function () {
	"use strict";

	var ERROR_MESSAGES = {
		SUBCLASS_NOT_CONSTRUCTOR: "Subclass was not a constructor.",
		SUPERCLASS_NOT_CONSTRUCTOR: "Superclass was not a constructor when extending {0}.",
		PROTOTYPE_NOT_CLEAN: 'Prototype must be clean to extend another class. {1} has already been defined on the prototype of {0}.',
		NOT_CONSTRUCTOR: '{0} definition for {1} must be a constructor, was {2}.',
		DOES_NOT_IMPLEMENT: "Class {0} does not implement the attributes '{1}' from protocol {2}.",
		PROPERTY_ALREADY_PRESENT: 'Could not copy {0} from {1} to {2} as it was already present.',
		NULL: "{0} for {1} must not be null or undefined.",
		ALREADY_PRESENT: 'Could not copy {0} from {1} to {2} as it was already present.',
		WRONG_TYPE: '{0} for {1} should have been of type {2}, was {3}.',
		TWO_CONSTRUCTORS: "Two different constructors provided for {0}, use only one of the classDefinition argument and extraProperties.constructor.",
		BAD_INSTALL: "Can only install to the global environment or a constructor, can't install to a {0}."
	};

	// Main API ////////////////////////////////////////////////////////////////////////////////////

	// only used for compatibility with shimmed, non es5 browsers.
	var internalUseNames = ["__multiparents__", "__interfaces__", "__assignable_from_cache__", "__id__"];

	/**
	 * Sets up the prototype chain for inheritance.
	 *
	 * <p>As well as setting up the prototype chain, this also copies so called 'class'
	 * definitions from the superclass to the subclass and makes sure that constructor
	 * will return the correct thing.</p>
	 *
	 * @throws Error if the prototype has been modified before extend is called.
	 *
	 * @memberOf topiarist
	 * @param {?function} classDefinition The constructor of the subclass.
	 * @param {!function} superclass The constructor of the superclass.
	 * @param {?object} [extraProperties] An object of extra properties to add to the subclasses prototype.
	 */
	function extend(classDefinition, superclass, extraProperties) {
		var subclassName = className(classDefinition, "Subclass");

		// Find the right classDefinition - either the one provided, a new one or the one from extraProperties.
		var extraPropertiesHasConstructor = extraProperties !== undefined && extraProperties.hasOwnProperty("constructor") && typeof extraProperties.constructor === 'function';
		if (classDefinition != null) {
			if (extraPropertiesHasConstructor && classDefinition !== extraProperties.constructor) {
				throw new Error(msg(ERROR_MESSAGES.TWO_CONSTRUCTORS, subclassName));
			}
		} else if (extraPropertiesHasConstructor) {
			classDefinition = extraProperties.constructor;
		} else {
			classDefinition = function() {
				superclass.apply(this, arguments);
			};
		}

		// check arguments
		assertArgumentOfType('function', classDefinition, ERROR_MESSAGES.SUBCLASS_NOT_CONSTRUCTOR);
		assertArgumentOfType('function', superclass, ERROR_MESSAGES.SUPERCLASS_NOT_CONSTRUCTOR, subclassName);
		assertNothingInObject(classDefinition.prototype, ERROR_MESSAGES.PROTOTYPE_NOT_CLEAN, subclassName);

		// copy class properties
		for (var staticPropertyName in superclass) {
			if (superclass.hasOwnProperty(staticPropertyName)) {
				// this is because we shouldn't copy nonenumerables, but removing enumerability isn't
				// shimmable in ie8.  We need to make sure we don't inadvertently copy across any
				// of the 'internal' fields we are using to keep track of things.
				if (internalUseNames.indexOf(staticPropertyName) >= 0) {
					continue;
				}

				classDefinition[staticPropertyName] = superclass[staticPropertyName];
			}
		}

		// create the superclass property on the subclass constructor
		defineProperty(classDefinition, 'superclass', { enumerable: false, value: superclass });

		// create the prototype with a constructor function.
		classDefinition.prototype = create(superclass.prototype, {
			"constructor": { enumerable: false,	value: classDefinition }
		});

		// copy everything from extra properties.
		if (extraProperties != null) {
			for (var property in extraProperties) {
				if (extraProperties.hasOwnProperty(property) && property !== 'constructor') {
					classDefinition.prototype[property] = extraProperties[property];
				}
			}
		}

		// this is purely to work around a bad ie8 shim, when ie8 is no longer needed it can be deleted.
		if (classDefinition.prototype.hasOwnProperty("__proto__")) {
			delete classDefinition.prototype["__proto__"];
		}

		clearAssignableCache(classDefinition, superclass);

		return classDefinition;
	}

	/**
	 * Mixes functionality in to a class.
	 *
	 * <p>Only functions are mixed in.</p>
	 *
	 * <p>Code in the mixin is sandboxed and only has access to a 'mixin instance' rather than
	 * the real instance.</p>
	 *
	 * @memberOf topiarist
	 * @param {function} target
	 * @param {function|Object} mix
	 */
	function mixin(target, mix) {
		assertArgumentOfType('function', target, ERROR_MESSAGES.NOT_CONSTRUCTOR, 'Target', 'mixin');

		mix = toFunction(mix, new TypeError(msg(ERROR_MESSAGES.WRONG_TYPE, 'Mix', 'mixin', 'non-null object or function', mix === null ? 'null' : typeof mix)));
		var targetPrototype = target.prototype, mixinProperties = mix.prototype, resultingProperties = {};
		var mixins = nonenum(target, '__multiparents__', []);
		var myMixId = mixins.length;

		for (var property in mixinProperties) {
			// property might spuriously be 'constructor' if you are in ie8 and using a shim.
			if (typeof mixinProperties[property] === 'function' && property !== 'constructor') {
				if (property in targetPrototype === false) {
					resultingProperties[property] = getSandboxedFunction(myMixId, mix, mixinProperties[property]);
				} else if (targetPrototype[property].__original__ !== mixinProperties[property]) {
					throw new Error(msg(ERROR_MESSAGES.PROPERTY_ALREADY_PRESENT, property, className(mix, 'mixin'), className(target, 'target')));
				}
			} // we only mixin functions
		}

		copy(resultingProperties, targetPrototype);
		mixins.push(mix);

		clearAssignableCache(target, mix);

		return target;
	}

	/**
	 * Provides multiple inheritance through copying.
	 *
	 * <p>This is discouraged; you should prefer to use aggregation first,
	 * single inheritance (extends) second, mixins third and this as
	 * a last resort.</p>
	 *
	 * @memberOf topiarist
	 * @param {function} target the class that should receive the functionality.
	 * @param {function|Object} parent the parent that provides the functionality.
	 */
	function inherit(target, parent) {
		assertArgumentOfType('function', target, ERROR_MESSAGES.NOT_CONSTRUCTOR, 'Target', 'inherit');
		parent = toFunction(parent, new TypeError(msg(ERROR_MESSAGES.WRONG_TYPE, 'Parent', 'inherit', 'non-null object or function', parent === null ? 'null' : typeof parent)));

		if (classIsA(target, parent)) {
			return target;
		}

		var resultingProperties = {};
		var targetPrototype = target.prototype;
		for (var propertyName in parent.prototype) {
			// These properties should be nonenumerable in modern browsers, but shims might
			// create them in ie8.
			if (propertyName === "constructor" || propertyName === "__proto__") continue;

			var notInTarget = targetPrototype[propertyName] === undefined;
			var parentHasNewerImplementation = notInTarget || isOverriderOf(propertyName, parent, target);
			if (parentHasNewerImplementation) {
				resultingProperties[propertyName] = parent.prototype[propertyName];
			} else {
				var areTheSame = targetPrototype[propertyName] === parent.prototype[propertyName];
				var targetIsUpToDate = areTheSame || isOverriderOf(propertyName, target, parent);
				if (targetIsUpToDate === false) {
					// target is not up to date, but we can't bring it up to date.
					throw new Error(msg(ERROR_MESSAGES.ALREADY_PRESENT, propertyName, className(parent, 'parent'), className(target, 'target')));
				}
				// otherwise we don't need to do anything.
			}
		}

		copy(resultingProperties, targetPrototype);
		var multiparents = nonenum(target, '__multiparents__', []);
		multiparents.push(parent);

		clearAssignableCache(target, parent);

		return target;
	}

	/**
	 * Declares that the provided class implements the provided protocol.
	 *
	 * <p>This involves checking that it does in fact implement the protocol and updating an
	 * internal list of interfaces attached to the class definition.</p>
	 *
	 * <p>It should be called after implementations are provided, i.e. at the end of the class definition.</p>
	 *
	 * @throws Error if there are any attributes on the protocol that are not matched on the class definition.
	 *
	 * @memberOf topiarist
	 * @param {function} classDefinition A constructor that should create objects matching the protocol.
	 * @param {function} protocol A constructor representing an interface that the class should implement.
	 */
	function implement(classDefinition, protocol) {
		assertArgumentOfType('function', classDefinition, ERROR_MESSAGES.NOT_CONSTRUCTOR, 'Class', 'implement');
		assertArgumentOfType('function', protocol, ERROR_MESSAGES.NOT_CONSTRUCTOR, 'Protocol', 'implement');

		var interfaces = nonenum(classDefinition, '__interfaces__', []);
		var missing = missingAttributes(classDefinition, protocol);
		if (missing.length > 0) {
			throw new Error(msg(ERROR_MESSAGES.DOES_NOT_IMPLEMENT, className(classDefinition, "provided"), missing.join("', '"), className(protocol, "provided")));
		} else {
			interfaces.push(protocol);
		}

		clearAssignableCache(classDefinition, protocol);

		return classDefinition;
	}

	/** @private */
	function fallbackIsAssignableFrom(classDefinition, parent) {
		if (classDefinition === parent || classDefinition.prototype instanceof parent) {
			return true;
		}
		var i, mixins = classDefinition.__multiparents__ || [], interfaces = classDefinition.__interfaces__ || [];

		// parent
		var superPrototype = (classDefinition.superclass && classDefinition.superclass.prototype) || getPrototypeOf(classDefinition.prototype);
		if (superPrototype != null && superPrototype !== classDefinition.prototype && classIsA(superPrototype.constructor, parent)) {
			return true;
		}

		// mixin chain
		for (i = 0; i < mixins.length; ++i) {
			if (classIsA(mixins[i], parent)) {
				return true;
			}
		}
		// interfaces chain
		for (i = 0; i < interfaces.length; ++i) {
			if (classIsA(interfaces[i], parent)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Checks to see if a class is a descendant of another class / interface / mixin.
	 *
	 * <ul><li>A class is a descendant of another class if the other class is in its prototype chain.
	 * </li><li>A class is a descendant of an interface if it has called implement that class or
	 * any class that this class is a descendant of has called implement for that class.
	 * </li><li>A class is a descendant of a mixin if it has called mixin for that mixin or
	 * any class that this class is a descendant of has called mixin for that mixin.
	 * </li></ul>
	 *
	 * @memberOf topiarist
	 * @param {function} classDefinition the child class.
	 * @param {function} constructor the class to check if this class is a descendant of.
	 * @returns {boolean} true if the class is a descendant, false otherwise.
	 */
	function classIsA(classDefinition, constructor) {
		// sneaky edge case where we're checking against an object literal we've mixed in or against a prototype of something.
		if (typeof constructor === 'object' && constructor.hasOwnProperty('constructor')) { constructor = constructor.constructor; }

		assertArgumentOfType('function', classDefinition, ERROR_MESSAGES.NOT_CONSTRUCTOR, 'Class', 'classIsA');
		assertArgumentOfType('function', constructor, ERROR_MESSAGES.NOT_CONSTRUCTOR, 'Parent', 'classIsA');

		// This is just a caching wrapper around fallbackIsAssignableFrom.
		var cache = nonenum(classDefinition, '__assignable_from_cache__', {});
		var parentId = classId(constructor);
		if (cache[parentId] == null) {
			cache[parentId] = fallbackIsAssignableFrom(classDefinition, constructor);
		}
		return cache[parentId];
	}

	/**
	 * Checks to see if an instance is defined to be a child of a parent.
	 *
	 * @memberOf topiarist
	 * @param {Object} instance An instance object to check.
	 * @param {function} parent A potential parent (see classIsA).
	 * @returns {boolean} true if this instance has been constructed from something that is assignable from the parent or is null, false otherwise.
	 */
	function isA(instance, parent) {
		// sneaky edge case where we're checking against an object literal we've mixed in or against a prototype of something.
		if (typeof parent == 'object' && parent.hasOwnProperty('constructor')) { parent = parent.constructor; }
		assertArgumentOfType('function', parent, ERROR_MESSAGES.NOT_CONSTRUCTOR, 'Parent', 'isA');
		if (instance == null) return false;
		if (instance instanceof parent) {
			return true;
		}
		return classIsA(instance.constructor, parent);
	}

	/**
	 * Does duck typing to determine if an instance object implements a protocol.
	 * <p>The protocol may be either an adhoc protocol, in which case it is an object
	 * or it can be a formal protocol in which case it's a function.</p>
	 *
	 * <p>In an adhoc protocol, you can use Number, Object, String and Boolean to indicate
	 * the type required on the instance.</p>
	 *
	 * @memberOf topiarist
	 * @param {Object} instance the object to check.
	 * @param {function|Object} protocol the description of the properties that the object should have.
	 * @returns {boolean} true if all the properties on the protocol were on the instance and of the right type.
	 */
	function fulfills(instance, protocol) {
		assertArgumentNotNullOrUndefined(instance, ERROR_MESSAGES.NULL, 'Object', 'fulfills');
		assertArgumentNotNullOrUndefined(protocol, ERROR_MESSAGES.NULL, 'Protocol', 'fulfills');

		var protocolIsConstructor = typeof protocol === 'function';
		if (protocolIsConstructor && isA(instance, protocol)) {
			return true;
		}

		var requirement = protocolIsConstructor ? protocol.prototype : protocol;
		for (var item in requirement) {
			var type = typeof instance[item];
			var required = requirement[item];
			if (required === Number) {
				if (type !== 'number') {
					return false;
				}
			} else if (required === Object) {
				if (type !== 'object') {
					return false;
				}
			} else if (required === String) {
				if (type !== 'string') {
					return false;
				}
			} else if (required === Boolean) {
				if (type !== 'boolean') {
					return false;
				}
			} else {
				if (type !== typeof required) {
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * Checks that a class provides a prototype that will fulfil a protocol.
	 *
	 * @memberOf topiarist
	 * @param {function} classDefinition
	 * @param {function|Object} protocol
	 * @returns {boolean}
	 */
	function classFulfills(classDefinition, protocol) {
		assertArgumentNotNullOrUndefined(classDefinition, ERROR_MESSAGES.NULL, 'Class', 'classFulfills');
		assertArgumentNotNullOrUndefined(protocol, ERROR_MESSAGES.NULL, 'Protocol', 'classFulfills');
		return fulfills(classDefinition.prototype, protocol);
	}

	// Auxillaries /////////////////////////////////////////////////////////////////////////////////

	var slice = Array.prototype.slice;

	function assertArgumentOfType(type, argument) {
		var actualType = typeof argument;
		if (actualType !== type) {
			var args = slice.call(arguments, 2);
			args.push(actualType);
			throw new TypeError(msg.apply(null, args));
		}
	}

	function assertNothingInObject(object) {
		for (var propertyName in object) {
			var args = slice.call(arguments, 1);
			args.push(propertyName);
			throw new Error(msg.apply(null, args));
		}
	}

	function assertArgumentNotNullOrUndefined(item) {
		if (item == null) {
			var args = slice.call(arguments, 1);
			throw new TypeError(msg.apply(null, args));
		}
	}

	function isOverriderOf(propertyName, sub, ancestor) {
		if (sub.prototype[propertyName] === ancestor.prototype[propertyName]) return false;
		var parents = getImmediateParents(sub);
		for (var i = 0; i < parents.length; ++i) {
			var parent = parents[i];
			if (parent.prototype[propertyName] === ancestor.prototype[propertyName]) return true;
			if (isOverriderOf(propertyName, parent, ancestor)) return true;
		}
		return false;
	}

	function getImmediateParents(sub) {
		var parents = (sub.__multiparents__ || []).slice();
		var parentPrototype = (sub.superclass && sub.superclass.prototype) || getPrototypeOf(sub.prototype);
		if (parentPrototype !== null && parentPrototype.constructor !== null && parentPrototype.constructor !== sub) {
			parents.push(parentPrototype.constructor);
		}
		return parents;
	}

	/**
	 * Interpolates a string with the arguments, used for error messages.
	 * @private **/
	function msg(str) {
		if (str == null) { return null; }
		for (var i = 1, len = arguments.length; i < len; ++i) {
			str = str.replace("{" + (i - 1) + "}", String(arguments[i]));
		}
		return str;
	}

	/**
	 * Returns a nonenumerable property if it exists, or creates one
	 * and returns that if it does not.
	 * @private
	 */
	function nonenum(object, propertyName, defaultValue) {
		var value = object[propertyName];
		if (value === undefined) {
			value = defaultValue;
			defineProperty(object, propertyName, {
				enumerable: false,
				value: value
			});
		}
		return value;
	}

	/**
	 * Easier for us if we treat everything as functions with prototypes.
	 * This function makes plain objects behave that way.
	 * @private
	 */
	function toFunction(obj, couldNotCastError) {
		if (obj == null) throw couldNotCastError;
		var result;
		if (typeof obj === 'object') {
			if (obj.hasOwnProperty('constructor')) {
				if (obj.constructor.prototype !== obj) throw couldNotCastError;
				result = obj.constructor;
			} else {
				var EmptyInitialiser = function () {};
				EmptyInitialiser.prototype = obj;
				defineProperty(obj, 'constructor', {
					enumerable: false, value: EmptyInitialiser
				});
				result = EmptyInitialiser;
			}
		} else if (typeof obj === 'function') {
			result = obj;
		} else {
			throw couldNotCastError;
		}
		return result;
	}

	/** @private */
	var currentId = 0;
	/**
	 * Returns the nonenumerable property __id__ of an object
	 * if it exists, otherwise adds one and returns that.
	 * @private
	 */
	function classId(func) {
		var result = func.__id__;
		if (result == null) {
			result = nonenum(func, '__id__', currentId++);
		}
		return result;
	}

	var nameFromToStringRegex = /^function\s?([^\s(]*)/;

	/**
	 * Gets the classname of an object or function if it can.  Otherwise returns the provided default.
	 *
	 * Getting the name of a function is not a standard feature, so while this will work in many
	 * cases, it should not be relied upon except for informational messages (e.g. logging and Error
	 * messages).
	 *
	 * @private
	 */
	function className(object, defaultName) {
		if (object == null) {
			return defaultName;
		}
		var result = "";
		if (typeof object === 'function') {
			if (object.name) {
				result = object.name;
			} else {
				var match = object.toString().match(nameFromToStringRegex);
				if (match !== null) {
					result = match[1];
				}
			}
		} else if (typeof object.constructor === 'function') {
			result = className(object.constructor, defaultName);
		}
		return result || defaultName;
	}

	/**
	 * Returns an array of all of the properties on a protocol that are not on classdef
	 * or are of a different type on classdef.
	 * @private
	 */
	function missingAttributes(classdef, protocol) {
		var result = [], obj = classdef.prototype, requirement = protocol.prototype;
		for (var item in requirement) {
			if (typeof obj[item] !== typeof requirement[item]) {
				result.push(item);
			}
		}
		for (var item in protocol) {
			if (protocol.hasOwnProperty(item) &&  typeof classdef[item] !== typeof protocol[item]) {
				// If we're in ie8, our internal variables won't be nonenumerable, so we
				// include a check for that here.
				if (internalUseNames.indexOf(item) < 0) {
					result.push(item+" (class method)");
				}
			}
		}
		return result;
	}

	/**
	 * Copies all properties from the source to the target (including inherited properties)
	 * and optionally makes them not enumerable.
	 * @private
	 */
	function copy(source, target, hidden) {
		for (var key in source) {
			defineProperty(target, key, {
				enumerable: hidden !== true,
				configurable: true, writable: true,
				value: source[key]
			});
		}
		return target;
	}

	/**
	 * Turns a function into a method by using 'this' as the first argument.
	 * @private
	 */
	function makeMethod(func) {
		return function () {
			var args = [this].concat(slice.call(arguments));
			return func.apply(null, args);
		};
	}

	/**
	 * Mixin functions are sandboxed into their own instance.
	 * @private
	 */
	function getSandboxedFunction(myMixId, mix, func) {
		var result = function () {
			var mixInstances = nonenum(this, '__multiparentInstances__', []);
			var mixInstance = mixInstances[myMixId];
			if (mixInstance == null) {
				if (typeof mix === 'function') {
					mixInstance = new mix();
				} else {
					mixInstance = create(mix);
				}
				// could add a nonenum pointer to __this__ or something if we wanted to
				// allow escape from the sandbox.
				mixInstances[myMixId] = mixInstance;
			}
			return func.apply(mixInstance, arguments);
		};
		nonenum(result, '__original__', func);
		nonenum(result, '__source__', mix);
		return result;
	}

	/**
	 * Clears the `__assignable_from_cache__` cache for target and parent.
	 * @private
	 */
	function clearAssignableCache(target, parent) {
		if ('__assignable_from_cache__' in target) {
			delete target.__assignable_from_cache__[classId(parent)];
		}
	}


	// Partial 'shams' to work around ie8s lack of es5 //////////////////////////////////////////////

	// These shams only cover the cases used within topiarist.
	// When IE8 support is no longer needed, all these can be dropped in favour of the es5 methods.

	var defineProperty = function(obj, prop, descriptor) {
		obj[prop] = descriptor.value;
	};
	if (Object.defineProperty) {
		try {
			// IE8 throws an error here.
			Object.defineProperty({}, 'x', {});
			defineProperty = Object.defineProperty;
		} catch (e) {}
	}

	var create = Object.create ? Object.create : function(proto, descriptors) {
		var myConstructor = function() {};
		myConstructor.prototype = proto;

		var result = new myConstructor();

		var keys = Object.keys(descriptors);
		for (var i = 0; i < keys.length; ++i) {
			var key = keys[i];
			defineProperty(result, key, descriptors[key]);
		}

		return result;
	};

	function getPrototypeOf(obj) {
		if (Object.getPrototypeOf) {
			var proto = Object.getPrototypeOf(obj);

			// to avoid bad shams...
			if (proto !== obj) return proto;
		}

		// this is what most shams do, but sometimes it's wrong.
		if (obj.constructor && obj.constructor.prototype && obj.constructor.prototype !== obj) {
			return obj.constructor.prototype;
		}

		// this works only if we've been kind enough to supply a superclass property
		// (which we do when we extend classes).
		if (obj.constructor && obj.constructor.superclass) {
			return obj.constructor.superclass.prototype;
		}

		// can't find a good prototype.
		return null;
	}


	// Exporting ///////////////////////////////////////////////////////////////////////////////////

	var methods = {
		'extend': extend, 'inherit': inherit, 'mixin': mixin, 'implement': implement,
		'classIsA': classIsA, 'isA': isA, 'fulfills': fulfills,
		'classFulfills': classFulfills
	};

	/* jshint evil:true */
	var global = (new Function('return this;'))();

	var exporting = {
		'exportTo': function(to) {
			copy(methods, to || global, true);
		},
		'install': function(target) {
			if (arguments.length > 0 && typeof target !== 'function') {
				throw new Error(msg(ERROR_MESSAGES.BAD_INSTALL, typeof target));
			}
			var isGlobalInstall = arguments.length < 1

			copy({
				isA: makeMethod(methods.isA),
				fulfills: makeMethod(methods.fulfills)
			}, isGlobalInstall ? Object.prototype : target.prototype, true);

			var itemsToInstallToFunction = {
				'classIsA': makeMethod(methods.classIsA),
				'implements': makeMethod(methods.implement),
				'fulfills': makeMethod(methods.classFulfills),
				// we can 'extend' a superclass to make a subclass.
				'extend': function(properties) {
					if (typeof properties === 'function') {
						return extend(properties, this);
					}
					return extend(null, this, properties);
				},
				'mixin': makeMethod(methods.mixin),
				'inherits': makeMethod(methods.inherit)
			};
			if (isGlobalInstall) {
				// no point in having subclass.extends unless it's global.
				itemsToInstallToFunction['extends'] = makeMethod(methods.extend);
			}

			copy(itemsToInstallToFunction, isGlobalInstall ? Function.prototype : target, isGlobalInstall);

			return target;
		}
	};

	methods.Base = exporting.install(function BaseClass() {});

	copy(methods, exporting);

	// not sure if this works in node-jasmine....
	if ('jasmine' in global) {
		var err = {};
		var getErr = function (key) {
			return function () {
				var message = ERROR_MESSAGES[key];
				var args = slice.call(arguments);
				args.unshift(message);
				var result = msg.apply(null, args);
				if (result === null) {
					throw new Error("No such error message " + key);
				}
				return result;
			};
		};
		for (var key in ERROR_MESSAGES) {
			err[key] = getErr(key);
		}
		exporting._err = err;
	}

	return exporting;
});



});


window.topiarist = require('topiarist');

// momentjs
//! moment.js
//! version : 2.4.0
//! authors : Tim Wood, Iskren Chernev, Moment.js contributors
//! license : MIT
//! momentjs.com

(function (undefined) {

	/************************************
	 Constants
	 ************************************/

	var moment,
		VERSION = "2.4.0",
		round = Math.round,
		i,

		YEAR = 0,
		MONTH = 1,
		DATE = 2,
		HOUR = 3,
		MINUTE = 4,
		SECOND = 5,
		MILLISECOND = 6,

	// internal storage for language config files
		languages = {},

	// check for nodeJS
		hasModule = (typeof module !== 'undefined' && module.exports),

	// ASP.NET json date format regex
		aspNetJsonRegex = /^\/?Date\((\-?\d+)/i,
		aspNetTimeSpanJsonRegex = /(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/,

	// from http://docs.closure-library.googlecode.com/git/closure_goog_date_date.js.source.html
	// somewhat more in line with 4.4.3.2 2004 spec, but allows decimal anywhere
		isoDurationRegex = /^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/,

	// format tokens
		formattingTokens = /(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,4}|X|zz?|ZZ?|.)/g,
		localFormattingTokens = /(\[[^\[]*\])|(\\)?(LT|LL?L?L?|l{1,4})/g,

	// parsing token regexes
		parseTokenOneOrTwoDigits = /\d\d?/, // 0 - 99
		parseTokenOneToThreeDigits = /\d{1,3}/, // 0 - 999
		parseTokenThreeDigits = /\d{3}/, // 000 - 999
		parseTokenFourDigits = /\d{1,4}/, // 0 - 9999
		parseTokenSixDigits = /[+\-]?\d{1,6}/, // -999,999 - 999,999
		parseTokenDigits = /\d+/, // nonzero number of digits
		parseTokenWord = /[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i, // any word (or two) characters or numbers including two/three word month in arabic.
		parseTokenTimezone = /Z|[\+\-]\d\d:?\d\d/i, // +00:00 -00:00 +0000 -0000 or Z
		parseTokenT = /T/i, // T (ISO seperator)
		parseTokenTimestampMs = /[\+\-]?\d+(\.\d{1,3})?/, // 123456789 123456789.123

	// preliminary iso regex
	// 0000-00-00 0000-W00 or 0000-W00-0 + T + 00 or 00:00 or 00:00:00 or 00:00:00.000 + +00:00 or +0000)
		isoRegex = /^\s*\d{4}-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d:?\d\d|Z)?)?$/,

		isoFormat = 'YYYY-MM-DDTHH:mm:ssZ',

		isoDates = [
			'YYYY-MM-DD',
			'GGGG-[W]WW',
			'GGGG-[W]WW-E',
			'YYYY-DDD'
		],

	// iso time formats and regexes
		isoTimes = [
			['HH:mm:ss.SSSS', /(T| )\d\d:\d\d:\d\d\.\d{1,3}/],
			['HH:mm:ss', /(T| )\d\d:\d\d:\d\d/],
			['HH:mm', /(T| )\d\d:\d\d/],
			['HH', /(T| )\d\d/]
		],

	// timezone chunker "+10:00" > ["10", "00"] or "-1530" > ["-15", "30"]
		parseTimezoneChunker = /([\+\-]|\d\d)/gi,

	// getter and setter names
		proxyGettersAndSetters = 'Date|Hours|Minutes|Seconds|Milliseconds'.split('|'),
		unitMillisecondFactors = {
			'Milliseconds' : 1,
			'Seconds' : 1e3,
			'Minutes' : 6e4,
			'Hours' : 36e5,
			'Days' : 864e5,
			'Months' : 2592e6,
			'Years' : 31536e6
		},

		unitAliases = {
			ms : 'millisecond',
			s : 'second',
			m : 'minute',
			h : 'hour',
			d : 'day',
			D : 'date',
			w : 'week',
			W : 'isoWeek',
			M : 'month',
			y : 'year',
			DDD : 'dayOfYear',
			e : 'weekday',
			E : 'isoWeekday',
			gg: 'weekYear',
			GG: 'isoWeekYear'
		},

		camelFunctions = {
			dayofyear : 'dayOfYear',
			isoweekday : 'isoWeekday',
			isoweek : 'isoWeek',
			weekyear : 'weekYear',
			isoweekyear : 'isoWeekYear'
		},

	// format function strings
		formatFunctions = {},

	// tokens to ordinalize and pad
		ordinalizeTokens = 'DDD w W M D d'.split(' '),
		paddedTokens = 'M D H h m s w W'.split(' '),

		formatTokenFunctions = {
			M    : function () {
				return this.month() + 1;
			},
			MMM  : function (format) {
				return this.lang().monthsShort(this, format);
			},
			MMMM : function (format) {
				return this.lang().months(this, format);
			},
			D    : function () {
				return this.date();
			},
			DDD  : function () {
				return this.dayOfYear();
			},
			d    : function () {
				return this.day();
			},
			dd   : function (format) {
				return this.lang().weekdaysMin(this, format);
			},
			ddd  : function (format) {
				return this.lang().weekdaysShort(this, format);
			},
			dddd : function (format) {
				return this.lang().weekdays(this, format);
			},
			w    : function () {
				return this.week();
			},
			W    : function () {
				return this.isoWeek();
			},
			YY   : function () {
				return leftZeroFill(this.year() % 100, 2);
			},
			YYYY : function () {
				return leftZeroFill(this.year(), 4);
			},
			YYYYY : function () {
				return leftZeroFill(this.year(), 5);
			},
			gg   : function () {
				return leftZeroFill(this.weekYear() % 100, 2);
			},
			gggg : function () {
				return this.weekYear();
			},
			ggggg : function () {
				return leftZeroFill(this.weekYear(), 5);
			},
			GG   : function () {
				return leftZeroFill(this.isoWeekYear() % 100, 2);
			},
			GGGG : function () {
				return this.isoWeekYear();
			},
			GGGGG : function () {
				return leftZeroFill(this.isoWeekYear(), 5);
			},
			e : function () {
				return this.weekday();
			},
			E : function () {
				return this.isoWeekday();
			},
			a    : function () {
				return this.lang().meridiem(this.hours(), this.minutes(), true);
			},
			A    : function () {
				return this.lang().meridiem(this.hours(), this.minutes(), false);
			},
			H    : function () {
				return this.hours();
			},
			h    : function () {
				return this.hours() % 12 || 12;
			},
			m    : function () {
				return this.minutes();
			},
			s    : function () {
				return this.seconds();
			},
			S    : function () {
				return toInt(this.milliseconds() / 100);
			},
			SS   : function () {
				return leftZeroFill(toInt(this.milliseconds() / 10), 2);
			},
			SSS  : function () {
				return leftZeroFill(this.milliseconds(), 3);
			},
			SSSS : function () {
				return leftZeroFill(this.milliseconds(), 3);
			},
			Z    : function () {
				var a = -this.zone(),
					b = "+";
				if (a < 0) {
					a = -a;
					b = "-";
				}
				return b + leftZeroFill(toInt(a / 60), 2) + ":" + leftZeroFill(toInt(a) % 60, 2);
			},
			ZZ   : function () {
				var a = -this.zone(),
					b = "+";
				if (a < 0) {
					a = -a;
					b = "-";
				}
				return b + leftZeroFill(toInt(10 * a / 6), 4);
			},
			z : function () {
				return this.zoneAbbr();
			},
			zz : function () {
				return this.zoneName();
			},
			X    : function () {
				return this.unix();
			}
		},

		lists = ['months', 'monthsShort', 'weekdays', 'weekdaysShort', 'weekdaysMin'];

	function padToken(func, count) {
		return function (a) {
			return leftZeroFill(func.call(this, a), count);
		};
	}
	function ordinalizeToken(func, period) {
		return function (a) {
			return this.lang().ordinal(func.call(this, a), period);
		};
	}

	while (ordinalizeTokens.length) {
		i = ordinalizeTokens.pop();
		formatTokenFunctions[i + 'o'] = ordinalizeToken(formatTokenFunctions[i], i);
	}
	while (paddedTokens.length) {
		i = paddedTokens.pop();
		formatTokenFunctions[i + i] = padToken(formatTokenFunctions[i], 2);
	}
	formatTokenFunctions.DDDD = padToken(formatTokenFunctions.DDD, 3);


	/************************************
	 Constructors
	 ************************************/

	function Language() {

	}

	// Moment prototype object
	function Moment(config) {
		checkOverflow(config);
		extend(this, config);
	}

	// Duration Constructor
	function Duration(duration) {
		var normalizedInput = normalizeObjectUnits(duration),
			years = normalizedInput.year || 0,
			months = normalizedInput.month || 0,
			weeks = normalizedInput.week || 0,
			days = normalizedInput.day || 0,
			hours = normalizedInput.hour || 0,
			minutes = normalizedInput.minute || 0,
			seconds = normalizedInput.second || 0,
			milliseconds = normalizedInput.millisecond || 0;

		// store reference to input for deterministic cloning
		this._input = duration;

		// representation for dateAddRemove
		this._milliseconds = +milliseconds +
			seconds * 1e3 + // 1000
			minutes * 6e4 + // 1000 * 60
			hours * 36e5; // 1000 * 60 * 60
		// Because of dateAddRemove treats 24 hours as different from a
		// day when working around DST, we need to store them separately
		this._days = +days +
			weeks * 7;
		// It is impossible translate months into days without knowing
		// which months you are are talking about, so we have to store
		// it separately.
		this._months = +months +
			years * 12;

		this._data = {};

		this._bubble();
	}

	/************************************
	 Helpers
	 ************************************/


	function extend(a, b) {
		for (var i in b) {
			if (b.hasOwnProperty(i)) {
				a[i] = b[i];
			}
		}

		if (b.hasOwnProperty("toString")) {
			a.toString = b.toString;
		}

		if (b.hasOwnProperty("valueOf")) {
			a.valueOf = b.valueOf;
		}

		return a;
	}

	function absRound(number) {
		if (number < 0) {
			return Math.ceil(number);
		} else {
			return Math.floor(number);
		}
	}

	// left zero fill a number
	// see http://jsperf.com/left-zero-filling for performance comparison
	function leftZeroFill(number, targetLength) {
		var output = number + '';
		while (output.length < targetLength) {
			output = '0' + output;
		}
		return output;
	}

	// helper function for _.addTime and _.subtractTime
	function addOrSubtractDurationFromMoment(mom, duration, isAdding, ignoreUpdateOffset) {
		var milliseconds = duration._milliseconds,
			days = duration._days,
			months = duration._months,
			minutes,
			hours;

		if (milliseconds) {
			mom._d.setTime(+mom._d + milliseconds * isAdding);
		}
		// store the minutes and hours so we can restore them
		if (days || months) {
			minutes = mom.minute();
			hours = mom.hour();
		}
		if (days) {
			mom.date(mom.date() + days * isAdding);
		}
		if (months) {
			mom.month(mom.month() + months * isAdding);
		}
		if (milliseconds && !ignoreUpdateOffset) {
			moment.updateOffset(mom);
		}
		// restore the minutes and hours after possibly changing dst
		if (days || months) {
			mom.minute(minutes);
			mom.hour(hours);
		}
	}

	// check if is an array
	function isArray(input) {
		return Object.prototype.toString.call(input) === '[object Array]';
	}

	function isDate(input) {
		return  Object.prototype.toString.call(input) === '[object Date]' ||
			input instanceof Date;
	}

	// compare two arrays, return the number of differences
	function compareArrays(array1, array2, dontConvert) {
		var len = Math.min(array1.length, array2.length),
			lengthDiff = Math.abs(array1.length - array2.length),
			diffs = 0,
			i;
		for (i = 0; i < len; i++) {
			if ((dontConvert && array1[i] !== array2[i]) ||
				(!dontConvert && toInt(array1[i]) !== toInt(array2[i]))) {
				diffs++;
			}
		}
		return diffs + lengthDiff;
	}

	function normalizeUnits(units) {
		if (units) {
			var lowered = units.toLowerCase().replace(/(.)s$/, '$1');
			units = unitAliases[units] || camelFunctions[lowered] || lowered;
		}
		return units;
	}

	function normalizeObjectUnits(inputObject) {
		var normalizedInput = {},
			normalizedProp,
			prop,
			index;

		for (prop in inputObject) {
			if (inputObject.hasOwnProperty(prop)) {
				normalizedProp = normalizeUnits(prop);
				if (normalizedProp) {
					normalizedInput[normalizedProp] = inputObject[prop];
				}
			}
		}

		return normalizedInput;
	}

	function makeList(field) {
		var count, setter;

		if (field.indexOf('week') === 0) {
			count = 7;
			setter = 'day';
		}
		else if (field.indexOf('month') === 0) {
			count = 12;
			setter = 'month';
		}
		else {
			return;
		}

		moment[field] = function (format, index) {
			var i, getter,
				method = moment.fn._lang[field],
				results = [];

			if (typeof format === 'number') {
				index = format;
				format = undefined;
			}

			getter = function (i) {
				var m = moment().utc().set(setter, i);
				return method.call(moment.fn._lang, m, format || '');
			};

			if (index != null) {
				return getter(index);
			}
			else {
				for (i = 0; i < count; i++) {
					results.push(getter(i));
				}
				return results;
			}
		};
	}

	function toInt(argumentForCoercion) {
		var coercedNumber = +argumentForCoercion,
			value = 0;

		if (coercedNumber !== 0 && isFinite(coercedNumber)) {
			if (coercedNumber >= 0) {
				value = Math.floor(coercedNumber);
			} else {
				value = Math.ceil(coercedNumber);
			}
		}

		return value;
	}

	function daysInMonth(year, month) {
		return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	}

	function daysInYear(year) {
		return isLeapYear(year) ? 366 : 365;
	}

	function isLeapYear(year) {
		return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	}

	function checkOverflow(m) {
		var overflow;
		if (m._a && m._pf.overflow === -2) {
			overflow =
				m._a[MONTH] < 0 || m._a[MONTH] > 11 ? MONTH :
					m._a[DATE] < 1 || m._a[DATE] > daysInMonth(m._a[YEAR], m._a[MONTH]) ? DATE :
						m._a[HOUR] < 0 || m._a[HOUR] > 23 ? HOUR :
							m._a[MINUTE] < 0 || m._a[MINUTE] > 59 ? MINUTE :
								m._a[SECOND] < 0 || m._a[SECOND] > 59 ? SECOND :
									m._a[MILLISECOND] < 0 || m._a[MILLISECOND] > 999 ? MILLISECOND :
										-1;

			if (m._pf._overflowDayOfYear && (overflow < YEAR || overflow > DATE)) {
				overflow = DATE;
			}

			m._pf.overflow = overflow;
		}
	}

	function initializeParsingFlags(config) {
		config._pf = {
			empty : false,
			unusedTokens : [],
			unusedInput : [],
			overflow : -2,
			charsLeftOver : 0,
			nullInput : false,
			invalidMonth : null,
			invalidFormat : false,
			userInvalidated : false,
			iso: false
		};
	}

	function isValid(m) {
		if (m._isValid == null) {
			m._isValid = !isNaN(m._d.getTime()) &&
				m._pf.overflow < 0 &&
				!m._pf.empty &&
				!m._pf.invalidMonth &&
				!m._pf.nullInput &&
				!m._pf.invalidFormat &&
				!m._pf.userInvalidated;

			if (m._strict) {
				m._isValid = m._isValid &&
					m._pf.charsLeftOver === 0 &&
					m._pf.unusedTokens.length === 0;
			}
		}
		return m._isValid;
	}

	function normalizeLanguage(key) {
		return key ? key.toLowerCase().replace('_', '-') : key;
	}

	/************************************
	 Languages
	 ************************************/


	extend(Language.prototype, {

		set : function (config) {
			var prop, i;
			for (i in config) {
				prop = config[i];
				if (typeof prop === 'function') {
					this[i] = prop;
				} else {
					this['_' + i] = prop;
				}
			}
		},

		_months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
		months : function (m) {
			return this._months[m.month()];
		},

		_monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
		monthsShort : function (m) {
			return this._monthsShort[m.month()];
		},

		monthsParse : function (monthName) {
			var i, mom, regex;

			if (!this._monthsParse) {
				this._monthsParse = [];
			}

			for (i = 0; i < 12; i++) {
				// make the regex if we don't have it already
				if (!this._monthsParse[i]) {
					mom = moment.utc([2000, i]);
					regex = '^' + this.months(mom, '') + '|^' + this.monthsShort(mom, '');
					this._monthsParse[i] = new RegExp(regex.replace('.', ''), 'i');
				}
				// test the regex
				if (this._monthsParse[i].test(monthName)) {
					return i;
				}
			}
		},

		_weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
		weekdays : function (m) {
			return this._weekdays[m.day()];
		},

		_weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
		weekdaysShort : function (m) {
			return this._weekdaysShort[m.day()];
		},

		_weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
		weekdaysMin : function (m) {
			return this._weekdaysMin[m.day()];
		},

		weekdaysParse : function (weekdayName) {
			var i, mom, regex;

			if (!this._weekdaysParse) {
				this._weekdaysParse = [];
			}

			for (i = 0; i < 7; i++) {
				// make the regex if we don't have it already
				if (!this._weekdaysParse[i]) {
					mom = moment([2000, 1]).day(i);
					regex = '^' + this.weekdays(mom, '') + '|^' + this.weekdaysShort(mom, '') + '|^' + this.weekdaysMin(mom, '');
					this._weekdaysParse[i] = new RegExp(regex.replace('.', ''), 'i');
				}
				// test the regex
				if (this._weekdaysParse[i].test(weekdayName)) {
					return i;
				}
			}
		},

		_longDateFormat : {
			LT : "h:mm A",
			L : "MM/DD/YYYY",
			LL : "MMMM D YYYY",
			LLL : "MMMM D YYYY LT",
			LLLL : "dddd, MMMM D YYYY LT"
		},
		longDateFormat : function (key) {
			var output = this._longDateFormat[key];
			if (!output && this._longDateFormat[key.toUpperCase()]) {
				output = this._longDateFormat[key.toUpperCase()].replace(/MMMM|MM|DD|dddd/g, function (val) {
					return val.slice(1);
				});
				this._longDateFormat[key] = output;
			}
			return output;
		},

		isPM : function (input) {
			// IE8 Quirks Mode & IE7 Standards Mode do not allow accessing strings like arrays
			// Using charAt should be more compatible.
			return ((input + '').toLowerCase().charAt(0) === 'p');
		},

		_meridiemParse : /[ap]\.?m?\.?/i,
		meridiem : function (hours, minutes, isLower) {
			if (hours > 11) {
				return isLower ? 'pm' : 'PM';
			} else {
				return isLower ? 'am' : 'AM';
			}
		},

		_calendar : {
			sameDay : '[Today at] LT',
			nextDay : '[Tomorrow at] LT',
			nextWeek : 'dddd [at] LT',
			lastDay : '[Yesterday at] LT',
			lastWeek : '[Last] dddd [at] LT',
			sameElse : 'L'
		},
		calendar : function (key, mom) {
			var output = this._calendar[key];
			return typeof output === 'function' ? output.apply(mom) : output;
		},

		_relativeTime : {
			future : "in %s",
			past : "%s ago",
			s : "a few seconds",
			m : "a minute",
			mm : "%d minutes",
			h : "an hour",
			hh : "%d hours",
			d : "a day",
			dd : "%d days",
			M : "a month",
			MM : "%d months",
			y : "a year",
			yy : "%d years"
		},
		relativeTime : function (number, withoutSuffix, string, isFuture) {
			var output = this._relativeTime[string];
			return (typeof output === 'function') ?
				output(number, withoutSuffix, string, isFuture) :
				output.replace(/%d/i, number);
		},
		pastFuture : function (diff, output) {
			var format = this._relativeTime[diff > 0 ? 'future' : 'past'];
			return typeof format === 'function' ? format(output) : format.replace(/%s/i, output);
		},

		ordinal : function (number) {
			return this._ordinal.replace("%d", number);
		},
		_ordinal : "%d",

		preparse : function (string) {
			return string;
		},

		postformat : function (string) {
			return string;
		},

		week : function (mom) {
			return weekOfYear(mom, this._week.dow, this._week.doy).week;
		},

		_week : {
			dow : 0, // Sunday is the first day of the week.
			doy : 6  // The week that contains Jan 1st is the first week of the year.
		},

		_invalidDate: 'Invalid date',
		invalidDate: function () {
			return this._invalidDate;
		}
	});

	// Loads a language definition into the `languages` cache.  The function
	// takes a key and optionally values.  If not in the browser and no values
	// are provided, it will load the language file module.  As a convenience,
	// this function also returns the language values.
	function loadLang(key, values) {
		values.abbr = key;
		if (!languages[key]) {
			languages[key] = new Language();
		}
		languages[key].set(values);
		return languages[key];
	}

	// Remove a language from the `languages` cache. Mostly useful in tests.
	function unloadLang(key) {
		delete languages[key];
	}

	// Determines which language definition to use and returns it.
	//
	// With no parameters, it will return the global language.  If you
	// pass in a language key, such as 'en', it will return the
	// definition for 'en', so long as 'en' has already been loaded using
	// moment.lang.
	function getLangDefinition(key) {
		var i = 0, j, lang, next, split,
			get = function (k) {
				if (!languages[k] && hasModule) {
					try {
						require('./lang/' + k);
					} catch (e) { }
				}
				return languages[k];
			};

		if (!key) {
			return moment.fn._lang;
		}

		if (!isArray(key)) {
			//short-circuit everything else
			lang = get(key);
			if (lang) {
				return lang;
			}
			key = [key];
		}

		//pick the language from the array
		//try ['en-au', 'en-gb'] as 'en-au', 'en-gb', 'en', as in move through the list trying each
		//substring from most specific to least, but move to the next array item if it's a more specific variant than the current root
		while (i < key.length) {
			split = normalizeLanguage(key[i]).split('-');
			j = split.length;
			next = normalizeLanguage(key[i + 1]);
			next = next ? next.split('-') : null;
			while (j > 0) {
				lang = get(split.slice(0, j).join('-'));
				if (lang) {
					return lang;
				}
				if (next && next.length >= j && compareArrays(split, next, true) >= j - 1) {
					//the next array item is better than a shallower substring of this one
					break;
				}
				j--;
			}
			i++;
		}
		return moment.fn._lang;
	}

	/************************************
	 Formatting
	 ************************************/


	function removeFormattingTokens(input) {
		if (input.match(/\[[\s\S]/)) {
			return input.replace(/^\[|\]$/g, "");
		}
		return input.replace(/\\/g, "");
	}

	function makeFormatFunction(format) {
		var array = format.match(formattingTokens), i, length;

		for (i = 0, length = array.length; i < length; i++) {
			if (formatTokenFunctions[array[i]]) {
				array[i] = formatTokenFunctions[array[i]];
			} else {
				array[i] = removeFormattingTokens(array[i]);
			}
		}

		return function (mom) {
			var output = "";
			for (i = 0; i < length; i++) {
				output += array[i] instanceof Function ? array[i].call(mom, format) : array[i];
			}
			return output;
		};
	}

	// format date using native date object
	function formatMoment(m, format) {

		if (!m.isValid()) {
			return m.lang().invalidDate();
		}

		format = expandFormat(format, m.lang());

		if (!formatFunctions[format]) {
			formatFunctions[format] = makeFormatFunction(format);
		}

		return formatFunctions[format](m);
	}

	function expandFormat(format, lang) {
		var i = 5;

		function replaceLongDateFormatTokens(input) {
			return lang.longDateFormat(input) || input;
		}

		localFormattingTokens.lastIndex = 0;
		while (i >= 0 && localFormattingTokens.test(format)) {
			format = format.replace(localFormattingTokens, replaceLongDateFormatTokens);
			localFormattingTokens.lastIndex = 0;
			i -= 1;
		}

		return format;
	}


	/************************************
	 Parsing
	 ************************************/


		// get the regex to find the next token
	function getParseRegexForToken(token, config) {
		var a;
		switch (token) {
			case 'DDDD':
				return parseTokenThreeDigits;
			case 'YYYY':
			case 'GGGG':
			case 'gggg':
				return parseTokenFourDigits;
			case 'YYYYY':
			case 'GGGGG':
			case 'ggggg':
				return parseTokenSixDigits;
			case 'S':
			case 'SS':
			case 'SSS':
			case 'DDD':
				return parseTokenOneToThreeDigits;
			case 'MMM':
			case 'MMMM':
			case 'dd':
			case 'ddd':
			case 'dddd':
				return parseTokenWord;
			case 'a':
			case 'A':
				return getLangDefinition(config._l)._meridiemParse;
			case 'X':
				return parseTokenTimestampMs;
			case 'Z':
			case 'ZZ':
				return parseTokenTimezone;
			case 'T':
				return parseTokenT;
			case 'SSSS':
				return parseTokenDigits;
			case 'MM':
			case 'DD':
			case 'YY':
			case 'GG':
			case 'gg':
			case 'HH':
			case 'hh':
			case 'mm':
			case 'ss':
			case 'M':
			case 'D':
			case 'd':
			case 'H':
			case 'h':
			case 'm':
			case 's':
			case 'w':
			case 'ww':
			case 'W':
			case 'WW':
			case 'e':
			case 'E':
				return parseTokenOneOrTwoDigits;
			default :
				a = new RegExp(regexpEscape(unescapeFormat(token.replace('\\', '')), "i"));
				return a;
		}
	}

	function timezoneMinutesFromString(string) {
		var tzchunk = (parseTokenTimezone.exec(string) || [])[0],
			parts = (tzchunk + '').match(parseTimezoneChunker) || ['-', 0, 0],
			minutes = +(parts[1] * 60) + toInt(parts[2]);

		return parts[0] === '+' ? -minutes : minutes;
	}

	// function to convert string input to date
	function addTimeToArrayFromToken(token, input, config) {
		var a, datePartArray = config._a;

		switch (token) {
			// MONTH
			case 'M' : // fall through to MM
			case 'MM' :
				if (input != null) {
					datePartArray[MONTH] = toInt(input) - 1;
				}
				break;
			case 'MMM' : // fall through to MMMM
			case 'MMMM' :
				a = getLangDefinition(config._l).monthsParse(input);
				// if we didn't find a month name, mark the date as invalid.
				if (a != null) {
					datePartArray[MONTH] = a;
				} else {
					config._pf.invalidMonth = input;
				}
				break;
			// DAY OF MONTH
			case 'D' : // fall through to DD
			case 'DD' :
				if (input != null) {
					datePartArray[DATE] = toInt(input);
				}
				break;
			// DAY OF YEAR
			case 'DDD' : // fall through to DDDD
			case 'DDDD' :
				if (input != null) {
					config._dayOfYear = toInt(input);
				}

				break;
			// YEAR
			case 'YY' :
				datePartArray[YEAR] = toInt(input) + (toInt(input) > 68 ? 1900 : 2000);
				break;
			case 'YYYY' :
			case 'YYYYY' :
				datePartArray[YEAR] = toInt(input);
				break;
			// AM / PM
			case 'a' : // fall through to A
			case 'A' :
				config._isPm = getLangDefinition(config._l).isPM(input);
				break;
			// 24 HOUR
			case 'H' : // fall through to hh
			case 'HH' : // fall through to hh
			case 'h' : // fall through to hh
			case 'hh' :
				datePartArray[HOUR] = toInt(input);
				break;
			// MINUTE
			case 'm' : // fall through to mm
			case 'mm' :
				datePartArray[MINUTE] = toInt(input);
				break;
			// SECOND
			case 's' : // fall through to ss
			case 'ss' :
				datePartArray[SECOND] = toInt(input);
				break;
			// MILLISECOND
			case 'S' :
			case 'SS' :
			case 'SSS' :
			case 'SSSS' :
				datePartArray[MILLISECOND] = toInt(('0.' + input) * 1000);
				break;
			// UNIX TIMESTAMP WITH MS
			case 'X':
				config._d = new Date(parseFloat(input) * 1000);
				break;
			// TIMEZONE
			case 'Z' : // fall through to ZZ
			case 'ZZ' :
				config._useUTC = true;
				config._tzm = timezoneMinutesFromString(input);
				break;
			case 'w':
			case 'ww':
			case 'W':
			case 'WW':
			case 'd':
			case 'dd':
			case 'ddd':
			case 'dddd':
			case 'e':
			case 'E':
				token = token.substr(0, 1);
			/* falls through */
			case 'gg':
			case 'gggg':
			case 'GG':
			case 'GGGG':
			case 'GGGGG':
				token = token.substr(0, 2);
				if (input) {
					config._w = config._w || {};
					config._w[token] = input;
				}
				break;
		}
	}

	// convert an array to a date.
	// the array should mirror the parameters below
	// note: all values past the year are optional and will default to the lowest possible value.
	// [year, month, day , hour, minute, second, millisecond]
	function dateFromConfig(config) {
		var i, date, input = [], currentDate,
			yearToUse, fixYear, w, temp, lang, weekday, week;

		if (config._d) {
			return;
		}

		currentDate = currentDateArray(config);

		//compute day of the year from weeks and weekdays
		if (config._w && config._a[DATE] == null && config._a[MONTH] == null) {
			fixYear = function (val) {
				return val ?
					(val.length < 3 ? (parseInt(val, 10) > 68 ? '19' + val : '20' + val) : val) :
					(config._a[YEAR] == null ? moment().weekYear() : config._a[YEAR]);
			};

			w = config._w;
			if (w.GG != null || w.W != null || w.E != null) {
				temp = dayOfYearFromWeeks(fixYear(w.GG), w.W || 1, w.E, 4, 1);
			}
			else {
				lang = getLangDefinition(config._l);
				weekday = w.d != null ?  parseWeekday(w.d, lang) :
					(w.e != null ?  parseInt(w.e, 10) + lang._week.dow : 0);

				week = parseInt(w.w, 10) || 1;

				//if we're parsing 'd', then the low day numbers may be next week
				if (w.d != null && weekday < lang._week.dow) {
					week++;
				}

				temp = dayOfYearFromWeeks(fixYear(w.gg), week, weekday, lang._week.doy, lang._week.dow);
			}

			config._a[YEAR] = temp.year;
			config._dayOfYear = temp.dayOfYear;
		}

		//if the day of the year is set, figure out what it is
		if (config._dayOfYear) {
			yearToUse = config._a[YEAR] == null ? currentDate[YEAR] : config._a[YEAR];

			if (config._dayOfYear > daysInYear(yearToUse)) {
				config._pf._overflowDayOfYear = true;
			}

			date = makeUTCDate(yearToUse, 0, config._dayOfYear);
			config._a[MONTH] = date.getUTCMonth();
			config._a[DATE] = date.getUTCDate();
		}

		// Default to current date.
		// * if no year, month, day of month are given, default to today
		// * if day of month is given, default month and year
		// * if month is given, default only year
		// * if year is given, don't default anything
		for (i = 0; i < 3 && config._a[i] == null; ++i) {
			config._a[i] = input[i] = currentDate[i];
		}

		// Zero out whatever was not defaulted, including time
		for (; i < 7; i++) {
			config._a[i] = input[i] = (config._a[i] == null) ? (i === 2 ? 1 : 0) : config._a[i];
		}

		// add the offsets to the time to be parsed so that we can have a clean array for checking isValid
		input[HOUR] += toInt((config._tzm || 0) / 60);
		input[MINUTE] += toInt((config._tzm || 0) % 60);

		config._d = (config._useUTC ? makeUTCDate : makeDate).apply(null, input);
	}

	function dateFromObject(config) {
		var normalizedInput;

		if (config._d) {
			return;
		}

		normalizedInput = normalizeObjectUnits(config._i);
		config._a = [
			normalizedInput.year,
			normalizedInput.month,
			normalizedInput.day,
			normalizedInput.hour,
			normalizedInput.minute,
			normalizedInput.second,
			normalizedInput.millisecond
		];

		dateFromConfig(config);
	}

	function currentDateArray(config) {
		var now = new Date();
		if (config._useUTC) {
			return [
				now.getUTCFullYear(),
				now.getUTCMonth(),
				now.getUTCDate()
			];
		} else {
			return [now.getFullYear(), now.getMonth(), now.getDate()];
		}
	}

	// date from string and format string
	function makeDateFromStringAndFormat(config) {

		config._a = [];
		config._pf.empty = true;

		// This array is used to make a Date, either with `new Date` or `Date.UTC`
		var lang = getLangDefinition(config._l),
			string = '' + config._i,
			i, parsedInput, tokens, token, skipped,
			stringLength = string.length,
			totalParsedInputLength = 0;

		tokens = expandFormat(config._f, lang).match(formattingTokens) || [];

		for (i = 0; i < tokens.length; i++) {
			token = tokens[i];
			parsedInput = (getParseRegexForToken(token, config).exec(string) || [])[0];
			if (parsedInput) {
				skipped = string.substr(0, string.indexOf(parsedInput));
				if (skipped.length > 0) {
					config._pf.unusedInput.push(skipped);
				}
				string = string.slice(string.indexOf(parsedInput) + parsedInput.length);
				totalParsedInputLength += parsedInput.length;
			}
			// don't parse if it's not a known token
			if (formatTokenFunctions[token]) {
				if (parsedInput) {
					config._pf.empty = false;
				}
				else {
					config._pf.unusedTokens.push(token);
				}
				addTimeToArrayFromToken(token, parsedInput, config);
			}
			else if (config._strict && !parsedInput) {
				config._pf.unusedTokens.push(token);
			}
		}

		// add remaining unparsed input length to the string
		config._pf.charsLeftOver = stringLength - totalParsedInputLength;
		if (string.length > 0) {
			config._pf.unusedInput.push(string);
		}

		// handle am pm
		if (config._isPm && config._a[HOUR] < 12) {
			config._a[HOUR] += 12;
		}
		// if is 12 am, change hours to 0
		if (config._isPm === false && config._a[HOUR] === 12) {
			config._a[HOUR] = 0;
		}

		dateFromConfig(config);
		checkOverflow(config);
	}

	function unescapeFormat(s) {
		return s.replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g, function (matched, p1, p2, p3, p4) {
			return p1 || p2 || p3 || p4;
		});
	}

	// Code from http://stackoverflow.com/questions/3561493/is-there-a-regexp-escape-function-in-javascript
	function regexpEscape(s) {
		return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
	}

	// date from string and array of format strings
	function makeDateFromStringAndArray(config) {
		var tempConfig,
			bestMoment,

			scoreToBeat,
			i,
			currentScore;

		if (config._f.length === 0) {
			config._pf.invalidFormat = true;
			config._d = new Date(NaN);
			return;
		}

		for (i = 0; i < config._f.length; i++) {
			currentScore = 0;
			tempConfig = extend({}, config);
			initializeParsingFlags(tempConfig);
			tempConfig._f = config._f[i];
			makeDateFromStringAndFormat(tempConfig);

			if (!isValid(tempConfig)) {
				continue;
			}

			// if there is any input that was not parsed add a penalty for that format
			currentScore += tempConfig._pf.charsLeftOver;

			//or tokens
			currentScore += tempConfig._pf.unusedTokens.length * 10;

			tempConfig._pf.score = currentScore;

			if (scoreToBeat == null || currentScore < scoreToBeat) {
				scoreToBeat = currentScore;
				bestMoment = tempConfig;
			}
		}

		extend(config, bestMoment || tempConfig);
	}

	// date from iso format
	function makeDateFromString(config) {
		var i,
			string = config._i,
			match = isoRegex.exec(string);

		if (match) {
			config._pf.iso = true;
			for (i = 4; i > 0; i--) {
				if (match[i]) {
					// match[5] should be "T" or undefined
					config._f = isoDates[i - 1] + (match[6] || " ");
					break;
				}
			}
			for (i = 0; i < 4; i++) {
				if (isoTimes[i][1].exec(string)) {
					config._f += isoTimes[i][0];
					break;
				}
			}
			if (parseTokenTimezone.exec(string)) {
				config._f += "Z";
			}
			makeDateFromStringAndFormat(config);
		}
		else {
			config._d = new Date(string);
		}
	}

	function makeDateFromInput(config) {
		var input = config._i,
			matched = aspNetJsonRegex.exec(input);

		if (input === undefined) {
			config._d = new Date();
		} else if (matched) {
			config._d = new Date(+matched[1]);
		} else if (typeof input === 'string') {
			makeDateFromString(config);
		} else if (isArray(input)) {
			config._a = input.slice(0);
			dateFromConfig(config);
		} else if (isDate(input)) {
			config._d = new Date(+input);
		} else if (typeof(input) === 'object') {
			dateFromObject(config);
		} else {
			config._d = new Date(input);
		}
	}

	function makeDate(y, m, d, h, M, s, ms) {
		//can't just apply() to create a date:
		//http://stackoverflow.com/questions/181348/instantiating-a-javascript-object-by-calling-prototype-constructor-apply
		var date = new Date(y, m, d, h, M, s, ms);

		//the date constructor doesn't accept years < 1970
		if (y < 1970) {
			date.setFullYear(y);
		}
		return date;
	}

	function makeUTCDate(y) {
		var date = new Date(Date.UTC.apply(null, arguments));
		if (y < 1970) {
			date.setUTCFullYear(y);
		}
		return date;
	}

	function parseWeekday(input, language) {
		if (typeof input === 'string') {
			if (!isNaN(input)) {
				input = parseInt(input, 10);
			}
			else {
				input = language.weekdaysParse(input);
				if (typeof input !== 'number') {
					return null;
				}
			}
		}
		return input;
	}

	/************************************
	 Relative Time
	 ************************************/


		// helper function for moment.fn.from, moment.fn.fromNow, and moment.duration.fn.humanize
	function substituteTimeAgo(string, number, withoutSuffix, isFuture, lang) {
		return lang.relativeTime(number || 1, !!withoutSuffix, string, isFuture);
	}

	function relativeTime(milliseconds, withoutSuffix, lang) {
		var seconds = round(Math.abs(milliseconds) / 1000),
			minutes = round(seconds / 60),
			hours = round(minutes / 60),
			days = round(hours / 24),
			years = round(days / 365),
			args = seconds < 45 && ['s', seconds] ||
				minutes === 1 && ['m'] ||
				minutes < 45 && ['mm', minutes] ||
				hours === 1 && ['h'] ||
				hours < 22 && ['hh', hours] ||
				days === 1 && ['d'] ||
				days <= 25 && ['dd', days] ||
				days <= 45 && ['M'] ||
				days < 345 && ['MM', round(days / 30)] ||
				years === 1 && ['y'] || ['yy', years];
		args[2] = withoutSuffix;
		args[3] = milliseconds > 0;
		args[4] = lang;
		return substituteTimeAgo.apply({}, args);
	}


	/************************************
	 Week of Year
	 ************************************/


		// firstDayOfWeek       0 = sun, 6 = sat
		//                      the day of the week that starts the week
		//                      (usually sunday or monday)
		// firstDayOfWeekOfYear 0 = sun, 6 = sat
		//                      the first week is the week that contains the first
		//                      of this day of the week
		//                      (eg. ISO weeks use thursday (4))
	function weekOfYear(mom, firstDayOfWeek, firstDayOfWeekOfYear) {
		var end = firstDayOfWeekOfYear - firstDayOfWeek,
			daysToDayOfWeek = firstDayOfWeekOfYear - mom.day(),
			adjustedMoment;


		if (daysToDayOfWeek > end) {
			daysToDayOfWeek -= 7;
		}

		if (daysToDayOfWeek < end - 7) {
			daysToDayOfWeek += 7;
		}

		adjustedMoment = moment(mom).add('d', daysToDayOfWeek);
		return {
			week: Math.ceil(adjustedMoment.dayOfYear() / 7),
			year: adjustedMoment.year()
		};
	}

	//http://en.wikipedia.org/wiki/ISO_week_date#Calculating_a_date_given_the_year.2C_week_number_and_weekday
	function dayOfYearFromWeeks(year, week, weekday, firstDayOfWeekOfYear, firstDayOfWeek) {
		var d = new Date(Date.UTC(year, 0)).getUTCDay(),
			daysToAdd, dayOfYear;

		weekday = weekday != null ? weekday : firstDayOfWeek;
		daysToAdd = firstDayOfWeek - d + (d > firstDayOfWeekOfYear ? 7 : 0);
		dayOfYear = 7 * (week - 1) + (weekday - firstDayOfWeek) + daysToAdd + 1;

		return {
			year: dayOfYear > 0 ? year : year - 1,
			dayOfYear: dayOfYear > 0 ?  dayOfYear : daysInYear(year - 1) + dayOfYear
		};
	}

	/************************************
	 Top Level Functions
	 ************************************/

	function makeMoment(config) {
		var input = config._i,
			format = config._f;

		if (typeof config._pf === 'undefined') {
			initializeParsingFlags(config);
		}

		if (input === null) {
			return moment.invalid({nullInput: true});
		}

		if (typeof input === 'string') {
			config._i = input = getLangDefinition().preparse(input);
		}

		if (moment.isMoment(input)) {
			config = extend({}, input);

			config._d = new Date(+input._d);
		} else if (format) {
			if (isArray(format)) {
				makeDateFromStringAndArray(config);
			} else {
				makeDateFromStringAndFormat(config);
			}
		} else {
			makeDateFromInput(config);
		}

		return new Moment(config);
	}

	moment = function (input, format, lang, strict) {
		if (typeof(lang) === "boolean") {
			strict = lang;
			lang = undefined;
		}
		return makeMoment({
			_i : input,
			_f : format,
			_l : lang,
			_strict : strict,
			_isUTC : false
		});
	};

	// creating with utc
	moment.utc = function (input, format, lang, strict) {
		var m;

		if (typeof(lang) === "boolean") {
			strict = lang;
			lang = undefined;
		}
		m = makeMoment({
			_useUTC : true,
			_isUTC : true,
			_l : lang,
			_i : input,
			_f : format,
			_strict : strict
		}).utc();

		return m;
	};

	// creating with unix timestamp (in seconds)
	moment.unix = function (input) {
		return moment(input * 1000);
	};

	// duration
	moment.duration = function (input, key) {
		var isDuration = moment.isDuration(input),
			isNumber = (typeof input === 'number'),
			duration = (isDuration ? input._input : (isNumber ? {} : input)),
		// matching against regexp is expensive, do it on demand
			match = null,
			sign,
			ret,
			parseIso,
			timeEmpty,
			dateTimeEmpty;

		if (isNumber) {
			if (key) {
				duration[key] = input;
			} else {
				duration.milliseconds = input;
			}
		} else if (!!(match = aspNetTimeSpanJsonRegex.exec(input))) {
			sign = (match[1] === "-") ? -1 : 1;
			duration = {
				y: 0,
				d: toInt(match[DATE]) * sign,
				h: toInt(match[HOUR]) * sign,
				m: toInt(match[MINUTE]) * sign,
				s: toInt(match[SECOND]) * sign,
				ms: toInt(match[MILLISECOND]) * sign
			};
		} else if (!!(match = isoDurationRegex.exec(input))) {
			sign = (match[1] === "-") ? -1 : 1;
			parseIso = function (inp) {
				// We'd normally use ~~inp for this, but unfortunately it also
				// converts floats to ints.
				// inp may be undefined, so careful calling replace on it.
				var res = inp && parseFloat(inp.replace(',', '.'));
				// apply sign while we're at it
				return (isNaN(res) ? 0 : res) * sign;
			};
			duration = {
				y: parseIso(match[2]),
				M: parseIso(match[3]),
				d: parseIso(match[4]),
				h: parseIso(match[5]),
				m: parseIso(match[6]),
				s: parseIso(match[7]),
				w: parseIso(match[8])
			};
		}

		ret = new Duration(duration);

		if (isDuration && input.hasOwnProperty('_lang')) {
			ret._lang = input._lang;
		}

		return ret;
	};

	// version number
	moment.version = VERSION;

	// default format
	moment.defaultFormat = isoFormat;

	// This function will be called whenever a moment is mutated.
	// It is intended to keep the offset in sync with the timezone.
	moment.updateOffset = function () {};

	// This function will load languages and then set the global language.  If
	// no arguments are passed in, it will simply return the current global
	// language key.
	moment.lang = function (key, values) {
		var r;
		if (!key) {
			return moment.fn._lang._abbr;
		}
		if (values) {
			loadLang(normalizeLanguage(key), values);
		} else if (values === null) {
			unloadLang(key);
			key = 'en';
		} else if (!languages[key]) {
			getLangDefinition(key);
		}
		r = moment.duration.fn._lang = moment.fn._lang = getLangDefinition(key);
		return r._abbr;
	};

	// returns language data
	moment.langData = function (key) {
		if (key && key._lang && key._lang._abbr) {
			key = key._lang._abbr;
		}
		return getLangDefinition(key);
	};

	// compare moment object
	moment.isMoment = function (obj) {
		return obj instanceof Moment;
	};

	// for typechecking Duration objects
	moment.isDuration = function (obj) {
		return obj instanceof Duration;
	};

	for (i = lists.length - 1; i >= 0; --i) {
		makeList(lists[i]);
	}

	moment.normalizeUnits = function (units) {
		return normalizeUnits(units);
	};

	moment.invalid = function (flags) {
		var m = moment.utc(NaN);
		if (flags != null) {
			extend(m._pf, flags);
		}
		else {
			m._pf.userInvalidated = true;
		}

		return m;
	};

	moment.parseZone = function (input) {
		return moment(input).parseZone();
	};

	/************************************
	 Moment Prototype
	 ************************************/


	extend(moment.fn = Moment.prototype, {

		clone : function () {
			return moment(this);
		},

		valueOf : function () {
			return +this._d + ((this._offset || 0) * 60000);
		},

		unix : function () {
			return Math.floor(+this / 1000);
		},

		toString : function () {
			return this.clone().lang('en').format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ");
		},

		toDate : function () {
			return this._offset ? new Date(+this) : this._d;
		},

		toISOString : function () {
			return formatMoment(moment(this).utc(), 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
		},

		toArray : function () {
			var m = this;
			return [
				m.year(),
				m.month(),
				m.date(),
				m.hours(),
				m.minutes(),
				m.seconds(),
				m.milliseconds()
			];
		},

		isValid : function () {
			return isValid(this);
		},

		isDSTShifted : function () {

			if (this._a) {
				return this.isValid() && compareArrays(this._a, (this._isUTC ? moment.utc(this._a) : moment(this._a)).toArray()) > 0;
			}

			return false;
		},

		parsingFlags : function () {
			return extend({}, this._pf);
		},

		invalidAt: function () {
			return this._pf.overflow;
		},

		utc : function () {
			return this.zone(0);
		},

		local : function () {
			this.zone(0);
			this._isUTC = false;
			return this;
		},

		format : function (inputString) {
			var output = formatMoment(this, inputString || moment.defaultFormat);
			return this.lang().postformat(output);
		},

		add : function (input, val) {
			var dur;
			// switch args to support add('s', 1) and add(1, 's')
			if (typeof input === 'string') {
				dur = moment.duration(+val, input);
			} else {
				dur = moment.duration(input, val);
			}
			addOrSubtractDurationFromMoment(this, dur, 1);
			return this;
		},

		subtract : function (input, val) {
			var dur;
			// switch args to support subtract('s', 1) and subtract(1, 's')
			if (typeof input === 'string') {
				dur = moment.duration(+val, input);
			} else {
				dur = moment.duration(input, val);
			}
			addOrSubtractDurationFromMoment(this, dur, -1);
			return this;
		},

		diff : function (input, units, asFloat) {
			var that = this._isUTC ? moment(input).zone(this._offset || 0) : moment(input).local(),
				zoneDiff = (this.zone() - that.zone()) * 6e4,
				diff, output;

			units = normalizeUnits(units);

			if (units === 'year' || units === 'month') {
				// average number of days in the months in the given dates
				diff = (this.daysInMonth() + that.daysInMonth()) * 432e5; // 24 * 60 * 60 * 1000 / 2
				// difference in months
				output = ((this.year() - that.year()) * 12) + (this.month() - that.month());
				// adjust by taking difference in days, average number of days
				// and dst in the given months.
				output += ((this - moment(this).startOf('month')) -
					(that - moment(that).startOf('month'))) / diff;
				// same as above but with zones, to negate all dst
				output -= ((this.zone() - moment(this).startOf('month').zone()) -
					(that.zone() - moment(that).startOf('month').zone())) * 6e4 / diff;
				if (units === 'year') {
					output = output / 12;
				}
			} else {
				diff = (this - that);
				output = units === 'second' ? diff / 1e3 : // 1000
					units === 'minute' ? diff / 6e4 : // 1000 * 60
						units === 'hour' ? diff / 36e5 : // 1000 * 60 * 60
							units === 'day' ? (diff - zoneDiff) / 864e5 : // 1000 * 60 * 60 * 24, negate dst
								units === 'week' ? (diff - zoneDiff) / 6048e5 : // 1000 * 60 * 60 * 24 * 7, negate dst
									diff;
			}
			return asFloat ? output : absRound(output);
		},

		from : function (time, withoutSuffix) {
			return moment.duration(this.diff(time)).lang(this.lang()._abbr).humanize(!withoutSuffix);
		},

		fromNow : function (withoutSuffix) {
			return this.from(moment(), withoutSuffix);
		},

		calendar : function () {
			var diff = this.diff(moment().zone(this.zone()).startOf('day'), 'days', true),
				format = diff < -6 ? 'sameElse' :
					diff < -1 ? 'lastWeek' :
						diff < 0 ? 'lastDay' :
							diff < 1 ? 'sameDay' :
								diff < 2 ? 'nextDay' :
									diff < 7 ? 'nextWeek' : 'sameElse';
			return this.format(this.lang().calendar(format, this));
		},

		isLeapYear : function () {
			return isLeapYear(this.year());
		},

		isDST : function () {
			return (this.zone() < this.clone().month(0).zone() ||
				this.zone() < this.clone().month(5).zone());
		},

		day : function (input) {
			var day = this._isUTC ? this._d.getUTCDay() : this._d.getDay();
			if (input != null) {
				input = parseWeekday(input, this.lang());
				return this.add({ d : input - day });
			} else {
				return day;
			}
		},

		month : function (input) {
			var utc = this._isUTC ? 'UTC' : '',
				dayOfMonth;

			if (input != null) {
				if (typeof input === 'string') {
					input = this.lang().monthsParse(input);
					if (typeof input !== 'number') {
						return this;
					}
				}

				dayOfMonth = this.date();
				this.date(1);
				this._d['set' + utc + 'Month'](input);
				this.date(Math.min(dayOfMonth, this.daysInMonth()));

				moment.updateOffset(this);
				return this;
			} else {
				return this._d['get' + utc + 'Month']();
			}
		},

		startOf: function (units) {
			units = normalizeUnits(units);
			// the following switch intentionally omits break keywords
			// to utilize falling through the cases.
			switch (units) {
				case 'year':
					this.month(0);
				/* falls through */
				case 'month':
					this.date(1);
				/* falls through */
				case 'week':
				case 'isoWeek':
				case 'day':
					this.hours(0);
				/* falls through */
				case 'hour':
					this.minutes(0);
				/* falls through */
				case 'minute':
					this.seconds(0);
				/* falls through */
				case 'second':
					this.milliseconds(0);
				/* falls through */
			}

			// weeks are a special case
			if (units === 'week') {
				this.weekday(0);
			} else if (units === 'isoWeek') {
				this.isoWeekday(1);
			}

			return this;
		},

		endOf: function (units) {
			units = normalizeUnits(units);
			return this.startOf(units).add((units === 'isoWeek' ? 'week' : units), 1).subtract('ms', 1);
		},

		isAfter: function (input, units) {
			units = typeof units !== 'undefined' ? units : 'millisecond';
			return +this.clone().startOf(units) > +moment(input).startOf(units);
		},

		isBefore: function (input, units) {
			units = typeof units !== 'undefined' ? units : 'millisecond';
			return +this.clone().startOf(units) < +moment(input).startOf(units);
		},

		isSame: function (input, units) {
			units = typeof units !== 'undefined' ? units : 'millisecond';
			return +this.clone().startOf(units) === +moment(input).startOf(units);
		},

		min: function (other) {
			other = moment.apply(null, arguments);
			return other < this ? this : other;
		},

		max: function (other) {
			other = moment.apply(null, arguments);
			return other > this ? this : other;
		},

		zone : function (input) {
			var offset = this._offset || 0;
			if (input != null) {
				if (typeof input === "string") {
					input = timezoneMinutesFromString(input);
				}
				if (Math.abs(input) < 16) {
					input = input * 60;
				}
				this._offset = input;
				this._isUTC = true;
				if (offset !== input) {
					addOrSubtractDurationFromMoment(this, moment.duration(offset - input, 'm'), 1, true);
				}
			} else {
				return this._isUTC ? offset : this._d.getTimezoneOffset();
			}
			return this;
		},

		zoneAbbr : function () {
			return this._isUTC ? "UTC" : "";
		},

		zoneName : function () {
			return this._isUTC ? "Coordinated Universal Time" : "";
		},

		parseZone : function () {
			if (typeof this._i === 'string') {
				this.zone(this._i);
			}
			return this;
		},

		hasAlignedHourOffset : function (input) {
			if (!input) {
				input = 0;
			}
			else {
				input = moment(input).zone();
			}

			return (this.zone() - input) % 60 === 0;
		},

		daysInMonth : function () {
			return daysInMonth(this.year(), this.month());
		},

		dayOfYear : function (input) {
			var dayOfYear = round((moment(this).startOf('day') - moment(this).startOf('year')) / 864e5) + 1;
			return input == null ? dayOfYear : this.add("d", (input - dayOfYear));
		},

		weekYear : function (input) {
			var year = weekOfYear(this, this.lang()._week.dow, this.lang()._week.doy).year;
			return input == null ? year : this.add("y", (input - year));
		},

		isoWeekYear : function (input) {
			var year = weekOfYear(this, 1, 4).year;
			return input == null ? year : this.add("y", (input - year));
		},

		week : function (input) {
			var week = this.lang().week(this);
			return input == null ? week : this.add("d", (input - week) * 7);
		},

		isoWeek : function (input) {
			var week = weekOfYear(this, 1, 4).week;
			return input == null ? week : this.add("d", (input - week) * 7);
		},

		weekday : function (input) {
			var weekday = (this.day() + 7 - this.lang()._week.dow) % 7;
			return input == null ? weekday : this.add("d", input - weekday);
		},

		isoWeekday : function (input) {
			// behaves the same as moment#day except
			// as a getter, returns 7 instead of 0 (1-7 range instead of 0-6)
			// as a setter, sunday should belong to the previous week.
			return input == null ? this.day() || 7 : this.day(this.day() % 7 ? input : input - 7);
		},

		get : function (units) {
			units = normalizeUnits(units);
			return this[units]();
		},

		set : function (units, value) {
			units = normalizeUnits(units);
			if (typeof this[units] === 'function') {
				this[units](value);
			}
			return this;
		},

		// If passed a language key, it will set the language for this
		// instance.  Otherwise, it will return the language configuration
		// variables for this instance.
		lang : function (key) {
			if (key === undefined) {
				return this._lang;
			} else {
				this._lang = getLangDefinition(key);
				return this;
			}
		}
	});

	// helper for adding shortcuts
	function makeGetterAndSetter(name, key) {
		moment.fn[name] = moment.fn[name + 's'] = function (input) {
			var utc = this._isUTC ? 'UTC' : '';
			if (input != null) {
				this._d['set' + utc + key](input);
				moment.updateOffset(this);
				return this;
			} else {
				return this._d['get' + utc + key]();
			}
		};
	}

	// loop through and add shortcuts (Month, Date, Hours, Minutes, Seconds, Milliseconds)
	for (i = 0; i < proxyGettersAndSetters.length; i ++) {
		makeGetterAndSetter(proxyGettersAndSetters[i].toLowerCase().replace(/s$/, ''), proxyGettersAndSetters[i]);
	}

	// add shortcut for year (uses different syntax than the getter/setter 'year' == 'FullYear')
	makeGetterAndSetter('year', 'FullYear');

	// add plural methods
	moment.fn.days = moment.fn.day;
	moment.fn.months = moment.fn.month;
	moment.fn.weeks = moment.fn.week;
	moment.fn.isoWeeks = moment.fn.isoWeek;

	// add aliased format methods
	moment.fn.toJSON = moment.fn.toISOString;

	/************************************
	 Duration Prototype
	 ************************************/


	extend(moment.duration.fn = Duration.prototype, {

		_bubble : function () {
			var milliseconds = this._milliseconds,
				days = this._days,
				months = this._months,
				data = this._data,
				seconds, minutes, hours, years;

			// The following code bubbles up values, see the tests for
			// examples of what that means.
			data.milliseconds = milliseconds % 1000;

			seconds = absRound(milliseconds / 1000);
			data.seconds = seconds % 60;

			minutes = absRound(seconds / 60);
			data.minutes = minutes % 60;

			hours = absRound(minutes / 60);
			data.hours = hours % 24;

			days += absRound(hours / 24);
			data.days = days % 30;

			months += absRound(days / 30);
			data.months = months % 12;

			years = absRound(months / 12);
			data.years = years;
		},

		weeks : function () {
			return absRound(this.days() / 7);
		},

		valueOf : function () {
			return this._milliseconds +
				this._days * 864e5 +
				(this._months % 12) * 2592e6 +
				toInt(this._months / 12) * 31536e6;
		},

		humanize : function (withSuffix) {
			var difference = +this,
				output = relativeTime(difference, !withSuffix, this.lang());

			if (withSuffix) {
				output = this.lang().pastFuture(difference, output);
			}

			return this.lang().postformat(output);
		},

		add : function (input, val) {
			// supports only 2.0-style add(1, 's') or add(moment)
			var dur = moment.duration(input, val);

			this._milliseconds += dur._milliseconds;
			this._days += dur._days;
			this._months += dur._months;

			this._bubble();

			return this;
		},

		subtract : function (input, val) {
			var dur = moment.duration(input, val);

			this._milliseconds -= dur._milliseconds;
			this._days -= dur._days;
			this._months -= dur._months;

			this._bubble();

			return this;
		},

		get : function (units) {
			units = normalizeUnits(units);
			return this[units.toLowerCase() + 's']();
		},

		as : function (units) {
			units = normalizeUnits(units);
			return this['as' + units.charAt(0).toUpperCase() + units.slice(1) + 's']();
		},

		lang : moment.fn.lang,

		toIsoString : function () {
			// inspired by https://github.com/dordille/moment-isoduration/blob/master/moment.isoduration.js
			var years = Math.abs(this.years()),
				months = Math.abs(this.months()),
				days = Math.abs(this.days()),
				hours = Math.abs(this.hours()),
				minutes = Math.abs(this.minutes()),
				seconds = Math.abs(this.seconds() + this.milliseconds() / 1000);

			if (!this.asSeconds()) {
				// this is the same as C#'s (Noda) and python (isodate)...
				// but not other JS (goog.date)
				return 'P0D';
			}

			return (this.asSeconds() < 0 ? '-' : '') +
				'P' +
				(years ? years + 'Y' : '') +
				(months ? months + 'M' : '') +
				(days ? days + 'D' : '') +
				((hours || minutes || seconds) ? 'T' : '') +
				(hours ? hours + 'H' : '') +
				(minutes ? minutes + 'M' : '') +
				(seconds ? seconds + 'S' : '');
		}
	});

	function makeDurationGetter(name) {
		moment.duration.fn[name] = function () {
			return this._data[name];
		};
	}

	function makeDurationAsGetter(name, factor) {
		moment.duration.fn['as' + name] = function () {
			return +this / factor;
		};
	}

	for (i in unitMillisecondFactors) {
		if (unitMillisecondFactors.hasOwnProperty(i)) {
			makeDurationAsGetter(i, unitMillisecondFactors[i]);
			makeDurationGetter(i.toLowerCase());
		}
	}

	makeDurationAsGetter('Weeks', 6048e5);
	moment.duration.fn.asMonths = function () {
		return (+this - this.years() * 31536e6) / 2592e6 + this.years() * 12;
	};


	/************************************
	 Default Lang
	 ************************************/


		// Set default language, other languages will inherit from English.
	moment.lang('en', {
		ordinal : function (number) {
			var b = number % 10,
				output = (toInt(number % 100 / 10) === 1) ? 'th' :
					(b === 1) ? 'st' :
						(b === 2) ? 'nd' :
							(b === 3) ? 'rd' : 'th';
			return number + output;
		}
	});

	// moment.js language configuration
// language : Moroccan Arabic (ar-ma)
// author : ElFadili Yassine : https://github.com/ElFadiliY
// author : Abdel Said : https://github.com/abdelsaid

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('ar-ma', {
			months : "ÙŠÙ†Ø§ÙŠØ±_ÙØ¨Ø±Ø§ÙŠØ±_Ù…Ø§Ø±Ø³_Ø£Ø¨Ø±ÙŠÙ„_Ù…Ø§ÙŠ_ÙŠÙˆÙ†ÙŠÙˆ_ÙŠÙˆÙ„ÙŠÙˆØ²_ØºØ´Øª_Ø´ØªÙ†Ø¨Ø±_Ø£ÙƒØªÙˆØ¨Ø±_Ù†ÙˆÙ†Ø¨Ø±_Ø¯Ø¬Ù†Ø¨Ø±".split("_"),
			monthsShort : "ÙŠÙ†Ø§ÙŠØ±_ÙØ¨Ø±Ø§ÙŠØ±_Ù…Ø§Ø±Ø³_Ø£Ø¨Ø±ÙŠÙ„_Ù…Ø§ÙŠ_ÙŠÙˆÙ†ÙŠÙˆ_ÙŠÙˆÙ„ÙŠÙˆØ²_ØºØ´Øª_Ø´ØªÙ†Ø¨Ø±_Ø£ÙƒØªÙˆØ¨Ø±_Ù†ÙˆÙ†Ø¨Ø±_Ø¯Ø¬Ù†Ø¨Ø±".split("_"),
			weekdays : "Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥ØªÙ†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),
			weekdaysShort : "Ø§Ø­Ø¯_Ø§ØªÙ†ÙŠÙ†_Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ø±Ø¨Ø¹Ø§Ø¡_Ø®Ù…ÙŠØ³_Ø¬Ù…Ø¹Ø©_Ø³Ø¨Øª".split("_"),
			weekdaysMin : "Ø­_Ù†_Ø«_Ø±_Ø®_Ø¬_Ø³".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[Ø§Ù„ÙŠÙˆÙ… Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",
				nextDay: '[ØºØ¯Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
				nextWeek: 'dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
				lastDay: '[Ø£Ù…Ø³ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
				lastWeek: 'dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "ÙÙŠ %s",
				past : "Ù…Ù†Ø° %s",
				s : "Ø«ÙˆØ§Ù†",
				m : "Ø¯Ù‚ÙŠÙ‚Ø©",
				mm : "%d Ø¯Ù‚Ø§Ø¦Ù‚",
				h : "Ø³Ø§Ø¹Ø©",
				hh : "%d Ø³Ø§Ø¹Ø§Øª",
				d : "ÙŠÙˆÙ…",
				dd : "%d Ø£ÙŠØ§Ù…",
				M : "Ø´Ù‡Ø±",
				MM : "%d Ø£Ø´Ù‡Ø±",
				y : "Ø³Ù†Ø©",
				yy : "%d Ø³Ù†ÙˆØ§Øª"
			},
			week : {
				dow : 6, // Saturday is the first day of the week.
				doy : 12  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Arabic (ar)
// author : Abdel Said : https://github.com/abdelsaid
// changes in months, weekdays : Ahmed Elkhatib

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('ar', {
			months : "ÙŠÙ†Ø§ÙŠØ±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_ÙØ¨Ø±Ø§ÙŠØ±/ Ø´Ø¨Ø§Ø·_Ù…Ø§Ø±Ø³/ Ø¢Ø°Ø§Ø±_Ø£Ø¨Ø±ÙŠÙ„/ Ù†ÙŠØ³Ø§Ù†_Ù…Ø§ÙŠÙˆ/ Ø£ÙŠØ§Ø±_ÙŠÙˆÙ†ÙŠÙˆ/ Ø­Ø²ÙŠØ±Ø§Ù†_ÙŠÙˆÙ„ÙŠÙˆ/ ØªÙ…ÙˆØ²_Ø£ØºØ³Ø·Ø³/ Ø¢Ø¨_Ø³Ø¨ØªÙ…Ø¨Ø±/ Ø£ÙŠÙ„ÙˆÙ„_Ø£ÙƒØªÙˆØ¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø£ÙˆÙ„_Ù†ÙˆÙÙ…Ø¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_Ø¯ÙŠØ³Ù…Ø¨Ø±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø£ÙˆÙ„".split("_"),
			monthsShort : "ÙŠÙ†Ø§ÙŠØ±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_ÙØ¨Ø±Ø§ÙŠØ±/ Ø´Ø¨Ø§Ø·_Ù…Ø§Ø±Ø³/ Ø¢Ø°Ø§Ø±_Ø£Ø¨Ø±ÙŠÙ„/ Ù†ÙŠØ³Ø§Ù†_Ù…Ø§ÙŠÙˆ/ Ø£ÙŠØ§Ø±_ÙŠÙˆÙ†ÙŠÙˆ/ Ø­Ø²ÙŠØ±Ø§Ù†_ÙŠÙˆÙ„ÙŠÙˆ/ ØªÙ…ÙˆØ²_Ø£ØºØ³Ø·Ø³/ Ø¢Ø¨_Ø³Ø¨ØªÙ…Ø¨Ø±/ Ø£ÙŠÙ„ÙˆÙ„_Ø£ÙƒØªÙˆØ¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø£ÙˆÙ„_Ù†ÙˆÙÙ…Ø¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_Ø¯ÙŠØ³Ù…Ø¨Ø±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø£ÙˆÙ„".split("_"),
			weekdays : "Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥Ø«Ù†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),
			weekdaysShort : "Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥Ø«Ù†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),
			weekdaysMin : "Ø­_Ù†_Ø«_Ø±_Ø®_Ø¬_Ø³".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[Ø§Ù„ÙŠÙˆÙ… Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",
				nextDay: '[ØºØ¯Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
				nextWeek: 'dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
				lastDay: '[Ø£Ù…Ø³ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
				lastWeek: 'dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "ÙÙŠ %s",
				past : "Ù…Ù†Ø° %s",
				s : "Ø«ÙˆØ§Ù†",
				m : "Ø¯Ù‚ÙŠÙ‚Ø©",
				mm : "%d Ø¯Ù‚Ø§Ø¦Ù‚",
				h : "Ø³Ø§Ø¹Ø©",
				hh : "%d Ø³Ø§Ø¹Ø§Øª",
				d : "ÙŠÙˆÙ…",
				dd : "%d Ø£ÙŠØ§Ù…",
				M : "Ø´Ù‡Ø±",
				MM : "%d Ø£Ø´Ù‡Ø±",
				y : "Ø³Ù†Ø©",
				yy : "%d Ø³Ù†ÙˆØ§Øª"
			},
			week : {
				dow : 6, // Saturday is the first day of the week.
				doy : 12  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : bulgarian (bg)
// author : Krasen Borisov : https://github.com/kraz

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('bg', {
			months : "ÑÐ½ÑƒÐ°Ñ€Ð¸_Ñ„ÐµÐ²Ñ€ÑƒÐ°Ñ€Ð¸_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€Ð¸Ð»_Ð¼Ð°Ð¹_ÑŽÐ½Ð¸_ÑŽÐ»Ð¸_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ¿Ñ‚ÐµÐ¼Ð²Ñ€Ð¸_Ð¾ÐºÑ‚Ð¾Ð¼Ð²Ñ€Ð¸_Ð½Ð¾ÐµÐ¼Ð²Ñ€Ð¸_Ð´ÐµÐºÐµÐ¼Ð²Ñ€Ð¸".split("_"),
			monthsShort : "ÑÐ½Ñ€_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_ÑŽÐ½Ð¸_ÑŽÐ»Ð¸_Ð°Ð²Ð³_ÑÐµÐ¿_Ð¾ÐºÑ‚_Ð½Ð¾Ðµ_Ð´ÐµÐº".split("_"),
			weekdays : "Ð½ÐµÐ´ÐµÐ»Ñ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»Ð½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÑÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÑŠÑ€Ñ‚ÑŠÐº_Ð¿ÐµÑ‚ÑŠÐº_ÑÑŠÐ±Ð¾Ñ‚Ð°".split("_"),
			weekdaysShort : "Ð½ÐµÐ´_Ð¿Ð¾Ð½_Ð²Ñ‚Ð¾_ÑÑ€Ñ_Ñ‡ÐµÑ‚_Ð¿ÐµÑ‚_ÑÑŠÐ±".split("_"),
			weekdaysMin : "Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "D.MM.YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendar : {
				sameDay : '[Ð”Ð½ÐµÑ Ð²] LT',
				nextDay : '[Ð£Ñ‚Ñ€Ðµ Ð²] LT',
				nextWeek : 'dddd [Ð²] LT',
				lastDay : '[Ð’Ñ‡ÐµÑ€Ð° Ð²] LT',
				lastWeek : function () {
					switch (this.day()) {
						case 0:
						case 3:
						case 6:
							return '[Ð’ Ð¸Ð·Ð¼Ð¸Ð½Ð°Ð»Ð°Ñ‚Ð°] dddd [Ð²] LT';
						case 1:
						case 2:
						case 4:
						case 5:
							return '[Ð’ Ð¸Ð·Ð¼Ð¸Ð½Ð°Ð»Ð¸Ñ] dddd [Ð²] LT';
					}
				},
				sameElse : 'L'
			},
			relativeTime : {
				future : "ÑÐ»ÐµÐ´ %s",
				past : "Ð¿Ñ€ÐµÐ´Ð¸ %s",
				s : "Ð½ÑÐºÐ¾Ð»ÐºÐ¾ ÑÐµÐºÑƒÐ½Ð´Ð¸",
				m : "Ð¼Ð¸Ð½ÑƒÑ‚Ð°",
				mm : "%d Ð¼Ð¸Ð½ÑƒÑ‚Ð¸",
				h : "Ñ‡Ð°Ñ",
				hh : "%d Ñ‡Ð°ÑÐ°",
				d : "Ð´ÐµÐ½",
				dd : "%d Ð´Ð½Ð¸",
				M : "Ð¼ÐµÑÐµÑ†",
				MM : "%d Ð¼ÐµÑÐµÑ†Ð°",
				y : "Ð³Ð¾Ð´Ð¸Ð½Ð°",
				yy : "%d Ð³Ð¾Ð´Ð¸Ð½Ð¸"
			},
			ordinal : function (number) {
				var lastDigit = number % 10,
					last2Digits = number % 100;
				if (number === 0) {
					return number + '-ÐµÐ²';
				} else if (last2Digits === 0) {
					return number + '-ÐµÐ½';
				} else if (last2Digits > 10 && last2Digits < 20) {
					return number + '-Ñ‚Ð¸';
				} else if (lastDigit === 1) {
					return number + '-Ð²Ð¸';
				} else if (lastDigit === 2) {
					return number + '-Ñ€Ð¸';
				} else if (lastDigit === 7 || lastDigit === 8) {
					return number + '-Ð¼Ð¸';
				} else {
					return number + '-Ñ‚Ð¸';
				}
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : breton (br)
// author : Jean-Baptiste Le Duigou : https://github.com/jbleduigou

	(function (factory) {
		factory(moment);
	}(function (moment) {
		function relativeTimeWithMutation(number, withoutSuffix, key) {
			var format = {
				'mm': "munutenn",
				'MM': "miz",
				'dd': "devezh"
			};
			return number + ' ' + mutation(format[key], number);
		}

		function specialMutationForYears(number) {
			switch (lastNumber(number)) {
				case 1:
				case 3:
				case 4:
				case 5:
				case 9:
					return number + ' bloaz';
				default:
					return number + ' vloaz';
			}
		}

		function lastNumber(number) {
			if (number > 9) {
				return lastNumber(number % 10);
			}
			return number;
		}

		function mutation(text, number) {
			if (number === 2) {
				return softMutation(text);
			}
			return text;
		}

		function softMutation(text) {
			var mutationTable = {
				'm': 'v',
				'b': 'v',
				'd': 'z'
			};
			if (mutationTable[text.charAt(0)] === undefined) {
				return text;
			}
			return mutationTable[text.charAt(0)] + text.substring(1);
		}

		return moment.lang('br', {
			months : "Genver_C'hwevrer_Meurzh_Ebrel_Mae_Mezheven_Gouere_Eost_Gwengolo_Here_Du_Kerzu".split("_"),
			monthsShort : "Gen_C'hwe_Meu_Ebr_Mae_Eve_Gou_Eos_Gwe_Her_Du_Ker".split("_"),
			weekdays : "Sul_Lun_Meurzh_Merc'her_Yaou_Gwener_Sadorn".split("_"),
			weekdaysShort : "Sul_Lun_Meu_Mer_Yao_Gwe_Sad".split("_"),
			weekdaysMin : "Su_Lu_Me_Mer_Ya_Gw_Sa".split("_"),
			longDateFormat : {
				LT : "h[e]mm A",
				L : "DD/MM/YYYY",
				LL : "D [a viz] MMMM YYYY",
				LLL : "D [a viz] MMMM YYYY LT",
				LLLL : "dddd, D [a viz] MMMM YYYY LT"
			},
			calendar : {
				sameDay : '[Hiziv da] LT',
				nextDay : '[Warc\'hoazh da] LT',
				nextWeek : 'dddd [da] LT',
				lastDay : '[Dec\'h da] LT',
				lastWeek : 'dddd [paset da] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "a-benn %s",
				past : "%s 'zo",
				s : "un nebeud segondennoÃ¹",
				m : "ur vunutenn",
				mm : relativeTimeWithMutation,
				h : "un eur",
				hh : "%d eur",
				d : "un devezh",
				dd : relativeTimeWithMutation,
				M : "ur miz",
				MM : relativeTimeWithMutation,
				y : "ur bloaz",
				yy : specialMutationForYears
			},
			ordinal : function (number) {
				var output = (number === 1) ? 'aÃ±' : 'vet';
				return number + output;
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : bosnian (bs)
// author : Nedim Cholich : https://github.com/frontyard
// based on (hr) translation by Bojan MarkoviÄ‡

	(function (factory) {
		factory(moment);
	}(function (moment) {

		function translate(number, withoutSuffix, key) {
			var result = number + " ";
			switch (key) {
				case 'm':
					return withoutSuffix ? 'jedna minuta' : 'jedne minute';
				case 'mm':
					if (number === 1) {
						result += 'minuta';
					} else if (number === 2 || number === 3 || number === 4) {
						result += 'minute';
					} else {
						result += 'minuta';
					}
					return result;
				case 'h':
					return withoutSuffix ? 'jedan sat' : 'jednog sata';
				case 'hh':
					if (number === 1) {
						result += 'sat';
					} else if (number === 2 || number === 3 || number === 4) {
						result += 'sata';
					} else {
						result += 'sati';
					}
					return result;
				case 'dd':
					if (number === 1) {
						result += 'dan';
					} else {
						result += 'dana';
					}
					return result;
				case 'MM':
					if (number === 1) {
						result += 'mjesec';
					} else if (number === 2 || number === 3 || number === 4) {
						result += 'mjeseca';
					} else {
						result += 'mjeseci';
					}
					return result;
				case 'yy':
					if (number === 1) {
						result += 'godina';
					} else if (number === 2 || number === 3 || number === 4) {
						result += 'godine';
					} else {
						result += 'godina';
					}
					return result;
			}
		}

		return moment.lang('bs', {
			months : "januar_februar_mart_april_maj_juni_juli_avgust_septembar_oktobar_novembar_decembar".split("_"),
			monthsShort : "jan._feb._mar._apr._maj._jun._jul._avg._sep._okt._nov._dec.".split("_"),
			weekdays : "nedjelja_ponedjeljak_utorak_srijeda_Äetvrtak_petak_subota".split("_"),
			weekdaysShort : "ned._pon._uto._sri._Äet._pet._sub.".split("_"),
			weekdaysMin : "ne_po_ut_sr_Äe_pe_su".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "DD. MM. YYYY",
				LL : "D. MMMM YYYY",
				LLL : "D. MMMM YYYY LT",
				LLLL : "dddd, D. MMMM YYYY LT"
			},
			calendar : {
				sameDay  : '[danas u] LT',
				nextDay  : '[sutra u] LT',

				nextWeek : function () {
					switch (this.day()) {
						case 0:
							return '[u] [nedjelju] [u] LT';
						case 3:
							return '[u] [srijedu] [u] LT';
						case 6:
							return '[u] [subotu] [u] LT';
						case 1:
						case 2:
						case 4:
						case 5:
							return '[u] dddd [u] LT';
					}
				},
				lastDay  : '[juÄer u] LT',
				lastWeek : function () {
					switch (this.day()) {
						case 0:
						case 3:
							return '[proÅ¡lu] dddd [u] LT';
						case 6:
							return '[proÅ¡le] [subote] [u] LT';
						case 1:
						case 2:
						case 4:
						case 5:
							return '[proÅ¡li] dddd [u] LT';
					}
				},
				sameElse : 'L'
			},
			relativeTime : {
				future : "za %s",
				past   : "prije %s",
				s      : "par sekundi",
				m      : translate,
				mm     : translate,
				h      : translate,
				hh     : translate,
				d      : "dan",
				dd     : translate,
				M      : "mjesec",
				MM     : translate,
				y      : "godinu",
				yy     : translate
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : catalan (ca)
// author : Juan G. Hurtado : https://github.com/juanghurtado

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('ca', {
			months : "Gener_Febrer_MarÃ§_Abril_Maig_Juny_Juliol_Agost_Setembre_Octubre_Novembre_Desembre".split("_"),
			monthsShort : "Gen._Febr._Mar._Abr._Mai._Jun._Jul._Ag._Set._Oct._Nov._Des.".split("_"),
			weekdays : "Diumenge_Dilluns_Dimarts_Dimecres_Dijous_Divendres_Dissabte".split("_"),
			weekdaysShort : "Dg._Dl._Dt._Dc._Dj._Dv._Ds.".split("_"),
			weekdaysMin : "Dg_Dl_Dt_Dc_Dj_Dv_Ds".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay : function () {
					return '[avui a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
				},
				nextDay : function () {
					return '[demÃ  a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
				},
				nextWeek : function () {
					return 'dddd [a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
				},
				lastDay : function () {
					return '[ahir a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
				},
				lastWeek : function () {
					return '[el] dddd [passat a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
				},
				sameElse : 'L'
			},
			relativeTime : {
				future : "en %s",
				past : "fa %s",
				s : "uns segons",
				m : "un minut",
				mm : "%d minuts",
				h : "una hora",
				hh : "%d hores",
				d : "un dia",
				dd : "%d dies",
				M : "un mes",
				MM : "%d mesos",
				y : "un any",
				yy : "%d anys"
			},
			ordinal : '%dÂº',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : czech (cs)
// author : petrbela : https://github.com/petrbela

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var months = "leden_Ãºnor_bÅ™ezen_duben_kvÄ›ten_Äerven_Äervenec_srpen_zÃ¡Å™Ã­_Å™Ã­jen_listopad_prosinec".split("_"),
			monthsShort = "led_Ãºno_bÅ™e_dub_kvÄ›_Ävn_Ävc_srp_zÃ¡Å™_Å™Ã­j_lis_pro".split("_");

		function plural(n) {
			return (n > 1) && (n < 5) && (~~(n / 10) !== 1);
		}

		function translate(number, withoutSuffix, key, isFuture) {
			var result = number + " ";
			switch (key) {
				case 's':  // a few seconds / in a few seconds / a few seconds ago
					return (withoutSuffix || isFuture) ? 'pÃ¡r vteÅ™in' : 'pÃ¡r vteÅ™inami';
				case 'm':  // a minute / in a minute / a minute ago
					return withoutSuffix ? 'minuta' : (isFuture ? 'minutu' : 'minutou');
				case 'mm': // 9 minutes / in 9 minutes / 9 minutes ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'minuty' : 'minut');
					} else {
						return result + 'minutami';
					}
					break;
				case 'h':  // an hour / in an hour / an hour ago
					return withoutSuffix ? 'hodina' : (isFuture ? 'hodinu' : 'hodinou');
				case 'hh': // 9 hours / in 9 hours / 9 hours ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'hodiny' : 'hodin');
					} else {
						return result + 'hodinami';
					}
					break;
				case 'd':  // a day / in a day / a day ago
					return (withoutSuffix || isFuture) ? 'den' : 'dnem';
				case 'dd': // 9 days / in 9 days / 9 days ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'dny' : 'dnÃ­');
					} else {
						return result + 'dny';
					}
					break;
				case 'M':  // a month / in a month / a month ago
					return (withoutSuffix || isFuture) ? 'mÄ›sÃ­c' : 'mÄ›sÃ­cem';
				case 'MM': // 9 months / in 9 months / 9 months ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'mÄ›sÃ­ce' : 'mÄ›sÃ­cÅ¯');
					} else {
						return result + 'mÄ›sÃ­ci';
					}
					break;
				case 'y':  // a year / in a year / a year ago
					return (withoutSuffix || isFuture) ? 'rok' : 'rokem';
				case 'yy': // 9 years / in 9 years / 9 years ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'roky' : 'let');
					} else {
						return result + 'lety';
					}
					break;
			}
		}

		return moment.lang('cs', {
			months : months,
			monthsShort : monthsShort,
			monthsParse : (function (months, monthsShort) {
				var i, _monthsParse = [];
				for (i = 0; i < 12; i++) {
					// use custom parser to solve problem with July (Äervenec)
					_monthsParse[i] = new RegExp('^' + months[i] + '$|^' + monthsShort[i] + '$', 'i');
				}
				return _monthsParse;
			}(months, monthsShort)),
			weekdays : "nedÄ›le_pondÄ›lÃ­_ÃºterÃ½_stÅ™eda_Ätvrtek_pÃ¡tek_sobota".split("_"),
			weekdaysShort : "ne_po_Ãºt_st_Ät_pÃ¡_so".split("_"),
			weekdaysMin : "ne_po_Ãºt_st_Ät_pÃ¡_so".split("_"),
			longDateFormat : {
				LT: "H:mm",
				L : "DD.MM.YYYY",
				LL : "D. MMMM YYYY",
				LLL : "D. MMMM YYYY LT",
				LLLL : "dddd D. MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[dnes v] LT",
				nextDay: '[zÃ­tra v] LT',
				nextWeek: function () {
					switch (this.day()) {
						case 0:
							return '[v nedÄ›li v] LT';
						case 1:
						case 2:
							return '[v] dddd [v] LT';
						case 3:
							return '[ve stÅ™edu v] LT';
						case 4:
							return '[ve Ätvrtek v] LT';
						case 5:
							return '[v pÃ¡tek v] LT';
						case 6:
							return '[v sobotu v] LT';
					}
				},
				lastDay: '[vÄera v] LT',
				lastWeek: function () {
					switch (this.day()) {
						case 0:
							return '[minulou nedÄ›li v] LT';
						case 1:
						case 2:
							return '[minulÃ©] dddd [v] LT';
						case 3:
							return '[minulou stÅ™edu v] LT';
						case 4:
						case 5:
							return '[minulÃ½] dddd [v] LT';
						case 6:
							return '[minulou sobotu v] LT';
					}
				},
				sameElse: "L"
			},
			relativeTime : {
				future : "za %s",
				past : "pÅ™ed %s",
				s : translate,
				m : translate,
				mm : translate,
				h : translate,
				hh : translate,
				d : translate,
				dd : translate,
				M : translate,
				MM : translate,
				y : translate,
				yy : translate
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : chuvash (cv)
// author : Anatoly Mironov : https://github.com/mirontoli

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('cv', {
			months : "ÐºÄƒÑ€Ð»Ð°Ñ‡_Ð½Ð°Ñ€ÄƒÑ_Ð¿ÑƒÑˆ_Ð°ÐºÐ°_Ð¼Ð°Ð¹_Ã§Ä•Ñ€Ñ‚Ð¼Ðµ_ÑƒÑ‚Äƒ_Ã§ÑƒÑ€Ð»Ð°_Ð°Ð²ÄƒÐ½_ÑŽÐ¿Ð°_Ñ‡Ó³Ðº_Ñ€Ð°ÑˆÑ‚Ð°Ð²".split("_"),
			monthsShort : "ÐºÄƒÑ€_Ð½Ð°Ñ€_Ð¿ÑƒÑˆ_Ð°ÐºÐ°_Ð¼Ð°Ð¹_Ã§Ä•Ñ€_ÑƒÑ‚Äƒ_Ã§ÑƒÑ€_Ð°Ð²_ÑŽÐ¿Ð°_Ñ‡Ó³Ðº_Ñ€Ð°Ñˆ".split("_"),
			weekdays : "Ð²Ñ‹Ñ€ÑÐ°Ñ€Ð½Ð¸ÐºÑƒÐ½_Ñ‚ÑƒÐ½Ñ‚Ð¸ÐºÑƒÐ½_Ñ‹Ñ‚Ð»Ð°Ñ€Ð¸ÐºÑƒÐ½_ÑŽÐ½ÐºÑƒÐ½_ÐºÄ•Ã§Ð½ÐµÑ€Ð½Ð¸ÐºÑƒÐ½_ÑÑ€Ð½ÐµÐºÑƒÐ½_ÑˆÄƒÐ¼Ð°Ñ‚ÐºÑƒÐ½".split("_"),
			weekdaysShort : "Ð²Ñ‹Ñ€_Ñ‚ÑƒÐ½_Ñ‹Ñ‚Ð»_ÑŽÐ½_ÐºÄ•Ã§_ÑÑ€Ð½_ÑˆÄƒÐ¼".split("_"),
			weekdaysMin : "Ð²Ñ€_Ñ‚Ð½_Ñ‹Ñ‚_ÑŽÐ½_ÐºÃ§_ÑÑ€_ÑˆÐ¼".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD-MM-YYYY",
				LL : "YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•]",
				LLL : "YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•], LT",
				LLLL : "dddd, YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•], LT"
			},
			calendar : {
				sameDay: '[ÐŸÐ°ÑÐ½] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
				nextDay: '[Ð«Ñ€Ð°Ð½] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
				lastDay: '[Ä”Ð½ÐµÑ€] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
				nextWeek: '[Ã‡Ð¸Ñ‚ÐµÑ] dddd LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
				lastWeek: '[Ð˜Ñ€Ñ‚Ð½Ä•] dddd LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
				sameElse: 'L'
			},
			relativeTime : {
				future : function (output) {
					var affix = /ÑÐµÑ…ÐµÑ‚$/i.exec(output) ? "Ñ€ÐµÐ½" : /Ã§ÑƒÐ»$/i.exec(output) ? "Ñ‚Ð°Ð½" : "Ñ€Ð°Ð½";
					return output + affix;
				},
				past : "%s ÐºÐ°ÑÐ»Ð»Ð°",
				s : "Ð¿Ä•Ñ€-Ð¸Ðº Ã§ÐµÐºÐºÑƒÐ½Ñ‚",
				m : "Ð¿Ä•Ñ€ Ð¼Ð¸Ð½ÑƒÑ‚",
				mm : "%d Ð¼Ð¸Ð½ÑƒÑ‚",
				h : "Ð¿Ä•Ñ€ ÑÐµÑ…ÐµÑ‚",
				hh : "%d ÑÐµÑ…ÐµÑ‚",
				d : "Ð¿Ä•Ñ€ ÐºÑƒÐ½",
				dd : "%d ÐºÑƒÐ½",
				M : "Ð¿Ä•Ñ€ ÑƒÐ¹ÄƒÑ…",
				MM : "%d ÑƒÐ¹ÄƒÑ…",
				y : "Ð¿Ä•Ñ€ Ã§ÑƒÐ»",
				yy : "%d Ã§ÑƒÐ»"
			},
			ordinal : '%d-Ð¼Ä•Ñˆ',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Welsh (cy)
// author : Robert Allen

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang("cy", {
			months: "Ionawr_Chwefror_Mawrth_Ebrill_Mai_Mehefin_Gorffennaf_Awst_Medi_Hydref_Tachwedd_Rhagfyr".split("_"),
			monthsShort: "Ion_Chwe_Maw_Ebr_Mai_Meh_Gor_Aws_Med_Hyd_Tach_Rhag".split("_"),
			weekdays: "Dydd Sul_Dydd Llun_Dydd Mawrth_Dydd Mercher_Dydd Iau_Dydd Gwener_Dydd Sadwrn".split("_"),
			weekdaysShort: "Sul_Llun_Maw_Mer_Iau_Gwe_Sad".split("_"),
			weekdaysMin: "Su_Ll_Ma_Me_Ia_Gw_Sa".split("_"),
			// time formats are the same as en-gb
			longDateFormat: {
				LT: "HH:mm",
				L: "DD/MM/YYYY",
				LL: "D MMMM YYYY",
				LLL: "D MMMM YYYY LT",
				LLLL: "dddd, D MMMM YYYY LT"
			},
			calendar: {
				sameDay: '[Heddiw am] LT',
				nextDay: '[Yfory am] LT',
				nextWeek: 'dddd [am] LT',
				lastDay: '[Ddoe am] LT',
				lastWeek: 'dddd [diwethaf am] LT',
				sameElse: 'L'
			},
			relativeTime: {
				future: "mewn %s",
				past: "%s yn &#244;l",
				s: "ychydig eiliadau",
				m: "munud",
				mm: "%d munud",
				h: "awr",
				hh: "%d awr",
				d: "diwrnod",
				dd: "%d diwrnod",
				M: "mis",
				MM: "%d mis",
				y: "blwyddyn",
				yy: "%d flynedd"
			},
			// traditional ordinal numbers above 31 are not commonly used in colloquial Welsh
			ordinal: function (number) {
				var b = number,
					output = '',
					lookup = [
						'', 'af', 'il', 'ydd', 'ydd', 'ed', 'ed', 'ed', 'fed', 'fed', 'fed', // 1af to 10fed
						'eg', 'fed', 'eg', 'eg', 'fed', 'eg', 'eg', 'fed', 'eg', 'fed' // 11eg to 20fed
					];

				if (b > 20) {
					if (b === 40 || b === 50 || b === 60 || b === 80 || b === 100) {
						output = 'fed'; // not 30ain, 70ain or 90ain
					} else {
						output = 'ain';
					}
				} else if (b > 0) {
					output = lookup[b];
				}

				return number + output;
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : danish (da)
// author : Ulrik Nielsen : https://github.com/mrbase

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('da', {
			months : "januar_februar_marts_april_maj_juni_juli_august_september_oktober_november_december".split("_"),
			monthsShort : "jan_feb_mar_apr_maj_jun_jul_aug_sep_okt_nov_dec".split("_"),
			weekdays : "sÃ¸ndag_mandag_tirsdag_onsdag_torsdag_fredag_lÃ¸rdag".split("_"),
			weekdaysShort : "sÃ¸n_man_tir_ons_tor_fre_lÃ¸r".split("_"),
			weekdaysMin : "sÃ¸_ma_ti_on_to_fr_lÃ¸".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D. MMMM, YYYY LT"
			},
			calendar : {
				sameDay : '[I dag kl.] LT',
				nextDay : '[I morgen kl.] LT',
				nextWeek : 'dddd [kl.] LT',
				lastDay : '[I gÃ¥r kl.] LT',
				lastWeek : '[sidste] dddd [kl] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "om %s",
				past : "%s siden",
				s : "fÃ¥ sekunder",
				m : "et minut",
				mm : "%d minutter",
				h : "en time",
				hh : "%d timer",
				d : "en dag",
				dd : "%d dage",
				M : "en mÃ¥ned",
				MM : "%d mÃ¥neder",
				y : "et Ã¥r",
				yy : "%d Ã¥r"
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : german (de)
// author : lluchs : https://github.com/lluchs
// author: Menelion ElensÃºle: https://github.com/Oire

	(function (factory) {
		factory(moment);
	}(function (moment) {
		function processRelativeTime(number, withoutSuffix, key, isFuture) {
			var format = {
				'm': ['eine Minute', 'einer Minute'],
				'h': ['eine Stunde', 'einer Stunde'],
				'd': ['ein Tag', 'einem Tag'],
				'dd': [number + ' Tage', number + ' Tagen'],
				'M': ['ein Monat', 'einem Monat'],
				'MM': [number + ' Monate', number + ' Monaten'],
				'y': ['ein Jahr', 'einem Jahr'],
				'yy': [number + ' Jahre', number + ' Jahren']
			};
			return withoutSuffix ? format[key][0] : format[key][1];
		}

		return moment.lang('de', {
			months : "Januar_Februar_MÃ¤rz_April_Mai_Juni_Juli_August_September_Oktober_November_Dezember".split("_"),
			monthsShort : "Jan._Febr._Mrz._Apr._Mai_Jun._Jul._Aug._Sept._Okt._Nov._Dez.".split("_"),
			weekdays : "Sonntag_Montag_Dienstag_Mittwoch_Donnerstag_Freitag_Samstag".split("_"),
			weekdaysShort : "So._Mo._Di._Mi._Do._Fr._Sa.".split("_"),
			weekdaysMin : "So_Mo_Di_Mi_Do_Fr_Sa".split("_"),
			longDateFormat : {
				LT: "H:mm [Uhr]",
				L : "DD.MM.YYYY",
				LL : "D. MMMM YYYY",
				LLL : "D. MMMM YYYY LT",
				LLLL : "dddd, D. MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[Heute um] LT",
				sameElse: "L",
				nextDay: '[Morgen um] LT',
				nextWeek: 'dddd [um] LT',
				lastDay: '[Gestern um] LT',
				lastWeek: '[letzten] dddd [um] LT'
			},
			relativeTime : {
				future : "in %s",
				past : "vor %s",
				s : "ein paar Sekunden",
				m : processRelativeTime,
				mm : "%d Minuten",
				h : processRelativeTime,
				hh : "%d Stunden",
				d : processRelativeTime,
				dd : processRelativeTime,
				M : processRelativeTime,
				MM : processRelativeTime,
				y : processRelativeTime,
				yy : processRelativeTime
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : modern greek (el)
// author : Aggelos Karalias : https://github.com/mehiel

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('el', {
			monthsNominativeEl : "Î™Î±Î½Î¿Ï…Î¬ÏÎ¹Î¿Ï‚_Î¦ÎµÎ²ÏÎ¿Ï…Î¬ÏÎ¹Î¿Ï‚_ÎœÎ¬ÏÏ„Î¹Î¿Ï‚_Î‘Ï€ÏÎ¯Î»Î¹Î¿Ï‚_ÎœÎ¬Î¹Î¿Ï‚_Î™Î¿ÏÎ½Î¹Î¿Ï‚_Î™Î¿ÏÎ»Î¹Î¿Ï‚_Î‘ÏÎ³Î¿Ï…ÏƒÏ„Î¿Ï‚_Î£ÎµÏ€Ï„Î­Î¼Î²ÏÎ¹Î¿Ï‚_ÎŸÎºÏ„ÏŽÎ²ÏÎ¹Î¿Ï‚_ÎÎ¿Î­Î¼Î²ÏÎ¹Î¿Ï‚_Î”ÎµÎºÎ­Î¼Î²ÏÎ¹Î¿Ï‚".split("_"),
			monthsGenitiveEl : "Î™Î±Î½Î¿Ï…Î±ÏÎ¯Î¿Ï…_Î¦ÎµÎ²ÏÎ¿Ï…Î±ÏÎ¯Î¿Ï…_ÎœÎ±ÏÏ„Î¯Î¿Ï…_Î‘Ï€ÏÎ¹Î»Î¯Î¿Ï…_ÎœÎ±ÎÎ¿Ï…_Î™Î¿Ï…Î½Î¯Î¿Ï…_Î™Î¿Ï…Î»Î¯Î¿Ï…_Î‘Ï…Î³Î¿ÏÏƒÏ„Î¿Ï…_Î£ÎµÏ€Ï„ÎµÎ¼Î²ÏÎ¯Î¿Ï…_ÎŸÎºÏ„Ï‰Î²ÏÎ¯Î¿Ï…_ÎÎ¿ÎµÎ¼Î²ÏÎ¯Î¿Ï…_Î”ÎµÎºÎµÎ¼Î²ÏÎ¯Î¿Ï…".split("_"),
			months : function (momentToFormat, format) {
				if (/D/.test(format.substring(0, format.indexOf("MMMM")))) { // if there is a day number before 'MMMM'
					return this._monthsGenitiveEl[momentToFormat.month()];
				} else {
					return this._monthsNominativeEl[momentToFormat.month()];
				}
			},
			monthsShort : "Î™Î±Î½_Î¦ÎµÎ²_ÎœÎ±Ï_Î‘Ï€Ï_ÎœÎ±ÏŠ_Î™Î¿Ï…Î½_Î™Î¿Ï…Î»_Î‘Ï…Î³_Î£ÎµÏ€_ÎŸÎºÏ„_ÎÎ¿Îµ_Î”ÎµÎº".split("_"),
			weekdays : "ÎšÏ…ÏÎ¹Î±ÎºÎ®_Î”ÎµÏ…Ï„Î­ÏÎ±_Î¤ÏÎ¯Ï„Î·_Î¤ÎµÏ„Î¬ÏÏ„Î·_Î Î­Î¼Ï€Ï„Î·_Î Î±ÏÎ±ÏƒÎºÎµÏ…Î®_Î£Î¬Î²Î²Î±Ï„Î¿".split("_"),
			weekdaysShort : "ÎšÏ…Ï_Î”ÎµÏ…_Î¤ÏÎ¹_Î¤ÎµÏ„_Î ÎµÎ¼_Î Î±Ï_Î£Î±Î²".split("_"),
			weekdaysMin : "ÎšÏ…_Î”Îµ_Î¤Ï_Î¤Îµ_Î Îµ_Î Î±_Î£Î±".split("_"),
			meridiem : function (hours, minutes, isLower) {
				if (hours > 11) {
					return isLower ? 'Î¼Î¼' : 'ÎœÎœ';
				} else {
					return isLower ? 'Ï€Î¼' : 'Î Îœ';
				}
			},
			longDateFormat : {
				LT : "h:mm A",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendarEl : {
				sameDay : '[Î£Î®Î¼ÎµÏÎ± {}] LT',
				nextDay : '[Î‘ÏÏÎ¹Î¿ {}] LT',
				nextWeek : 'dddd [{}] LT',
				lastDay : '[Î§Î¸ÎµÏ‚ {}] LT',
				lastWeek : '[Ï„Î·Î½ Ï€ÏÎ¿Î·Î³Î¿ÏÎ¼ÎµÎ½Î·] dddd [{}] LT',
				sameElse : 'L'
			},
			calendar : function (key, mom) {
				var output = this._calendarEl[key],
					hours = mom && mom.hours();

				return output.replace("{}", (hours % 12 === 1 ? "ÏƒÏ„Î·" : "ÏƒÏ„Î¹Ï‚"));
			},
			relativeTime : {
				future : "ÏƒÎµ %s",
				past : "%s Ï€ÏÎ¹Î½",
				s : "Î´ÎµÏ…Ï„ÎµÏÏŒÎ»ÎµÏ€Ï„Î±",
				m : "Î­Î½Î± Î»ÎµÏ€Ï„ÏŒ",
				mm : "%d Î»ÎµÏ€Ï„Î¬",
				h : "Î¼Î¯Î± ÏŽÏÎ±",
				hh : "%d ÏŽÏÎµÏ‚",
				d : "Î¼Î¯Î± Î¼Î­ÏÎ±",
				dd : "%d Î¼Î­ÏÎµÏ‚",
				M : "Î­Î½Î±Ï‚ Î¼Î®Î½Î±Ï‚",
				MM : "%d Î¼Î®Î½ÎµÏ‚",
				y : "Î­Î½Î±Ï‚ Ï‡ÏÏŒÎ½Î¿Ï‚",
				yy : "%d Ï‡ÏÏŒÎ½Î¹Î±"
			},
			ordinal : function (number) {
				return number + 'Î·';
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : australian english (en-au)

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('en-au', {
			months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
			monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
			weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
			weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
			weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
			longDateFormat : {
				LT : "h:mm A",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendar : {
				sameDay : '[Today at] LT',
				nextDay : '[Tomorrow at] LT',
				nextWeek : 'dddd [at] LT',
				lastDay : '[Yesterday at] LT',
				lastWeek : '[Last] dddd [at] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "in %s",
				past : "%s ago",
				s : "a few seconds",
				m : "a minute",
				mm : "%d minutes",
				h : "an hour",
				hh : "%d hours",
				d : "a day",
				dd : "%d days",
				M : "a month",
				MM : "%d months",
				y : "a year",
				yy : "%d years"
			},
			ordinal : function (number) {
				var b = number % 10,
					output = (~~ (number % 100 / 10) === 1) ? 'th' :
						(b === 1) ? 'st' :
							(b === 2) ? 'nd' :
								(b === 3) ? 'rd' : 'th';
				return number + output;
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : canadian english (en-ca)
// author : Jonathan Abourbih : https://github.com/jonbca

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('en-ca', {
			months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
			monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
			weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
			weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
			weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
			longDateFormat : {
				LT : "h:mm A",
				L : "YYYY-MM-DD",
				LL : "D MMMM, YYYY",
				LLL : "D MMMM, YYYY LT",
				LLLL : "dddd, D MMMM, YYYY LT"
			},
			calendar : {
				sameDay : '[Today at] LT',
				nextDay : '[Tomorrow at] LT',
				nextWeek : 'dddd [at] LT',
				lastDay : '[Yesterday at] LT',
				lastWeek : '[Last] dddd [at] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "in %s",
				past : "%s ago",
				s : "a few seconds",
				m : "a minute",
				mm : "%d minutes",
				h : "an hour",
				hh : "%d hours",
				d : "a day",
				dd : "%d days",
				M : "a month",
				MM : "%d months",
				y : "a year",
				yy : "%d years"
			},
			ordinal : function (number) {
				var b = number % 10,
					output = (~~ (number % 100 / 10) === 1) ? 'th' :
						(b === 1) ? 'st' :
							(b === 2) ? 'nd' :
								(b === 3) ? 'rd' : 'th';
				return number + output;
			}
		});
	}));
// moment.js language configuration
// language : great britain english (en-gb)
// author : Chris Gedrim : https://github.com/chrisgedrim

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('en-gb', {
			months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
			monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
			weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
			weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
			weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendar : {
				sameDay : '[Today at] LT',
				nextDay : '[Tomorrow at] LT',
				nextWeek : 'dddd [at] LT',
				lastDay : '[Yesterday at] LT',
				lastWeek : '[Last] dddd [at] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "in %s",
				past : "%s ago",
				s : "a few seconds",
				m : "a minute",
				mm : "%d minutes",
				h : "an hour",
				hh : "%d hours",
				d : "a day",
				dd : "%d days",
				M : "a month",
				MM : "%d months",
				y : "a year",
				yy : "%d years"
			},
			ordinal : function (number) {
				var b = number % 10,
					output = (~~ (number % 100 / 10) === 1) ? 'th' :
						(b === 1) ? 'st' :
							(b === 2) ? 'nd' :
								(b === 3) ? 'rd' : 'th';
				return number + output;
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : esperanto (eo)
// author : Colin Dean : https://github.com/colindean
// komento: Mi estas malcerta se mi korekte traktis akuzativojn en tiu traduko.
//          Se ne, bonvolu korekti kaj avizi min por ke mi povas lerni!

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('eo', {
			months : "januaro_februaro_marto_aprilo_majo_junio_julio_aÅ­gusto_septembro_oktobro_novembro_decembro".split("_"),
			monthsShort : "jan_feb_mar_apr_maj_jun_jul_aÅ­g_sep_okt_nov_dec".split("_"),
			weekdays : "DimanÄ‰o_Lundo_Mardo_Merkredo_Ä´aÅ­do_Vendredo_Sabato".split("_"),
			weekdaysShort : "Dim_Lun_Mard_Merk_Ä´aÅ­_Ven_Sab".split("_"),
			weekdaysMin : "Di_Lu_Ma_Me_Ä´a_Ve_Sa".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "YYYY-MM-DD",
				LL : "D[-an de] MMMM, YYYY",
				LLL : "D[-an de] MMMM, YYYY LT",
				LLLL : "dddd, [la] D[-an de] MMMM, YYYY LT"
			},
			meridiem : function (hours, minutes, isLower) {
				if (hours > 11) {
					return isLower ? 'p.t.m.' : 'P.T.M.';
				} else {
					return isLower ? 'a.t.m.' : 'A.T.M.';
				}
			},
			calendar : {
				sameDay : '[HodiaÅ­ je] LT',
				nextDay : '[MorgaÅ­ je] LT',
				nextWeek : 'dddd [je] LT',
				lastDay : '[HieraÅ­ je] LT',
				lastWeek : '[pasinta] dddd [je] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "je %s",
				past : "antaÅ­ %s",
				s : "sekundoj",
				m : "minuto",
				mm : "%d minutoj",
				h : "horo",
				hh : "%d horoj",
				d : "tago",//ne 'diurno', Ä‰ar estas uzita por proksimumo
				dd : "%d tagoj",
				M : "monato",
				MM : "%d monatoj",
				y : "jaro",
				yy : "%d jaroj"
			},
			ordinal : "%da",
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : spanish (es)
// author : Julio NapurÃ­ : https://github.com/julionc

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('es', {
			months : "enero_febrero_marzo_abril_mayo_junio_julio_agosto_septiembre_octubre_noviembre_diciembre".split("_"),
			monthsShort : "ene._feb._mar._abr._may._jun._jul._ago._sep._oct._nov._dic.".split("_"),
			weekdays : "domingo_lunes_martes_miÃ©rcoles_jueves_viernes_sÃ¡bado".split("_"),
			weekdaysShort : "dom._lun._mar._miÃ©._jue._vie._sÃ¡b.".split("_"),
			weekdaysMin : "Do_Lu_Ma_Mi_Ju_Vi_SÃ¡".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "DD/MM/YYYY",
				LL : "D [de] MMMM [de] YYYY",
				LLL : "D [de] MMMM [de] YYYY LT",
				LLLL : "dddd, D [de] MMMM [de] YYYY LT"
			},
			calendar : {
				sameDay : function () {
					return '[hoy a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
				},
				nextDay : function () {
					return '[maÃ±ana a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
				},
				nextWeek : function () {
					return 'dddd [a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
				},
				lastDay : function () {
					return '[ayer a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
				},
				lastWeek : function () {
					return '[el] dddd [pasado a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
				},
				sameElse : 'L'
			},
			relativeTime : {
				future : "en %s",
				past : "hace %s",
				s : "unos segundos",
				m : "un minuto",
				mm : "%d minutos",
				h : "una hora",
				hh : "%d horas",
				d : "un dÃ­a",
				dd : "%d dÃ­as",
				M : "un mes",
				MM : "%d meses",
				y : "un aÃ±o",
				yy : "%d aÃ±os"
			},
			ordinal : '%dÂº',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : estonian (et)
// author : Henry Kehlmann : https://github.com/madhenry

	(function (factory) {
		factory(moment);
	}(function (moment) {
		function translateSeconds(number, withoutSuffix, key, isFuture) {
			return (isFuture || withoutSuffix) ? 'paari sekundi' : 'paar sekundit';
		}

		return moment.lang('et', {
			months        : "jaanuar_veebruar_mÃ¤rts_aprill_mai_juuni_juuli_august_september_oktoober_november_detsember".split("_"),
			monthsShort   : "jaan_veebr_mÃ¤rts_apr_mai_juuni_juuli_aug_sept_okt_nov_dets".split("_"),
			weekdays      : "pÃ¼hapÃ¤ev_esmaspÃ¤ev_teisipÃ¤ev_kolmapÃ¤ev_neljapÃ¤ev_reede_laupÃ¤ev".split("_"),
			weekdaysShort : "P_E_T_K_N_R_L".split("_"),
			weekdaysMin   : "P_E_T_K_N_R_L".split("_"),
			longDateFormat : {
				LT   : "H:mm",
				L    : "DD.MM.YYYY",
				LL   : "D. MMMM YYYY",
				LLL  : "D. MMMM YYYY LT",
				LLLL : "dddd, D. MMMM YYYY LT"
			},
			calendar : {
				sameDay  : '[TÃ¤na,] LT',
				nextDay  : '[Homme,] LT',
				nextWeek : '[JÃ¤rgmine] dddd LT',
				lastDay  : '[Eile,] LT',
				lastWeek : '[Eelmine] dddd LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s pÃ¤rast",
				past   : "%s tagasi",
				s      : translateSeconds,
				m      : "minut",
				mm     : "%d minutit",
				h      : "tund",
				hh     : "%d tundi",
				d      : "pÃ¤ev",
				dd     : "%d pÃ¤eva",
				M      : "kuu",
				MM     : "%d kuud",
				y      : "aasta",
				yy     : "%d aastat"
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : euskara (eu)
// author : Eneko Illarramendi : https://github.com/eillarra

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('eu', {
			months : "urtarrila_otsaila_martxoa_apirila_maiatza_ekaina_uztaila_abuztua_iraila_urria_azaroa_abendua".split("_"),
			monthsShort : "urt._ots._mar._api._mai._eka._uzt._abu._ira._urr._aza._abe.".split("_"),
			weekdays : "igandea_astelehena_asteartea_asteazkena_osteguna_ostirala_larunbata".split("_"),
			weekdaysShort : "ig._al._ar._az._og._ol._lr.".split("_"),
			weekdaysMin : "ig_al_ar_az_og_ol_lr".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "YYYY-MM-DD",
				LL : "YYYY[ko] MMMM[ren] D[a]",
				LLL : "YYYY[ko] MMMM[ren] D[a] LT",
				LLLL : "dddd, YYYY[ko] MMMM[ren] D[a] LT",
				l : "YYYY-M-D",
				ll : "YYYY[ko] MMM D[a]",
				lll : "YYYY[ko] MMM D[a] LT",
				llll : "ddd, YYYY[ko] MMM D[a] LT"
			},
			calendar : {
				sameDay : '[gaur] LT[etan]',
				nextDay : '[bihar] LT[etan]',
				nextWeek : 'dddd LT[etan]',
				lastDay : '[atzo] LT[etan]',
				lastWeek : '[aurreko] dddd LT[etan]',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s barru",
				past : "duela %s",
				s : "segundo batzuk",
				m : "minutu bat",
				mm : "%d minutu",
				h : "ordu bat",
				hh : "%d ordu",
				d : "egun bat",
				dd : "%d egun",
				M : "hilabete bat",
				MM : "%d hilabete",
				y : "urte bat",
				yy : "%d urte"
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Persian Language
// author : Ebrahim Byagowi : https://github.com/ebraminio

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var symbolMap = {
			'1': 'Û±',
			'2': 'Û²',
			'3': 'Û³',
			'4': 'Û´',
			'5': 'Ûµ',
			'6': 'Û¶',
			'7': 'Û·',
			'8': 'Û¸',
			'9': 'Û¹',
			'0': 'Û°'
		}, numberMap = {
			'Û±': '1',
			'Û²': '2',
			'Û³': '3',
			'Û´': '4',
			'Ûµ': '5',
			'Û¶': '6',
			'Û·': '7',
			'Û¸': '8',
			'Û¹': '9',
			'Û°': '0'
		};

		return moment.lang('fa', {
			months : 'Ú˜Ø§Ù†ÙˆÛŒÙ‡_ÙÙˆØ±ÛŒÙ‡_Ù…Ø§Ø±Ø³_Ø¢ÙˆØ±ÛŒÙ„_Ù…Ù‡_Ú˜ÙˆØ¦Ù†_Ú˜ÙˆØ¦ÛŒÙ‡_Ø§ÙˆØª_Ø³Ù¾ØªØ§Ù…Ø¨Ø±_Ø§Ú©ØªØ¨Ø±_Ù†ÙˆØ§Ù…Ø¨Ø±_Ø¯Ø³Ø§Ù…Ø¨Ø±'.split('_'),
			monthsShort : 'Ú˜Ø§Ù†ÙˆÛŒÙ‡_ÙÙˆØ±ÛŒÙ‡_Ù…Ø§Ø±Ø³_Ø¢ÙˆØ±ÛŒÙ„_Ù…Ù‡_Ú˜ÙˆØ¦Ù†_Ú˜ÙˆØ¦ÛŒÙ‡_Ø§ÙˆØª_Ø³Ù¾ØªØ§Ù…Ø¨Ø±_Ø§Ú©ØªØ¨Ø±_Ù†ÙˆØ§Ù…Ø¨Ø±_Ø¯Ø³Ø§Ù…Ø¨Ø±'.split('_'),
			weekdays : 'ÛŒÚ©\u200cØ´Ù†Ø¨Ù‡_Ø¯ÙˆØ´Ù†Ø¨Ù‡_Ø³Ù‡\u200cØ´Ù†Ø¨Ù‡_Ú†Ù‡Ø§Ø±Ø´Ù†Ø¨Ù‡_Ù¾Ù†Ø¬\u200cØ´Ù†Ø¨Ù‡_Ø¬Ù…Ø¹Ù‡_Ø´Ù†Ø¨Ù‡'.split('_'),
			weekdaysShort : 'ÛŒÚ©\u200cØ´Ù†Ø¨Ù‡_Ø¯ÙˆØ´Ù†Ø¨Ù‡_Ø³Ù‡\u200cØ´Ù†Ø¨Ù‡_Ú†Ù‡Ø§Ø±Ø´Ù†Ø¨Ù‡_Ù¾Ù†Ø¬\u200cØ´Ù†Ø¨Ù‡_Ø¬Ù…Ø¹Ù‡_Ø´Ù†Ø¨Ù‡'.split('_'),
			weekdaysMin : 'ÛŒ_Ø¯_Ø³_Ú†_Ù¾_Ø¬_Ø´'.split('_'),
			longDateFormat : {
				LT : 'HH:mm',
				L : 'DD/MM/YYYY',
				LL : 'D MMMM YYYY',
				LLL : 'D MMMM YYYY LT',
				LLLL : 'dddd, D MMMM YYYY LT'
			},
			meridiem : function (hour, minute, isLower) {
				if (hour < 12) {
					return "Ù‚Ø¨Ù„ Ø§Ø² Ø¸Ù‡Ø±";
				} else {
					return "Ø¨Ø¹Ø¯ Ø§Ø² Ø¸Ù‡Ø±";
				}
			},
			calendar : {
				sameDay : '[Ø§Ù…Ø±ÙˆØ² Ø³Ø§Ø¹Øª] LT',
				nextDay : '[ÙØ±Ø¯Ø§ Ø³Ø§Ø¹Øª] LT',
				nextWeek : 'dddd [Ø³Ø§Ø¹Øª] LT',
				lastDay : '[Ø¯ÛŒØ±ÙˆØ² Ø³Ø§Ø¹Øª] LT',
				lastWeek : 'dddd [Ù¾ÛŒØ´] [Ø³Ø§Ø¹Øª] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : 'Ø¯Ø± %s',
				past : '%s Ù¾ÛŒØ´',
				s : 'Ú†Ù†Ø¯ÛŒÙ† Ø«Ø§Ù†ÛŒÙ‡',
				m : 'ÛŒÚ© Ø¯Ù‚ÛŒÙ‚Ù‡',
				mm : '%d Ø¯Ù‚ÛŒÙ‚Ù‡',
				h : 'ÛŒÚ© Ø³Ø§Ø¹Øª',
				hh : '%d Ø³Ø§Ø¹Øª',
				d : 'ÛŒÚ© Ø±ÙˆØ²',
				dd : '%d Ø±ÙˆØ²',
				M : 'ÛŒÚ© Ù…Ø§Ù‡',
				MM : '%d Ù…Ø§Ù‡',
				y : 'ÛŒÚ© Ø³Ø§Ù„',
				yy : '%d Ø³Ø§Ù„'
			},
			preparse: function (string) {
				return string.replace(/[Û°-Û¹]/g, function (match) {
					return numberMap[match];
				}).replace(/ØŒ/g, ',');
			},
			postformat: function (string) {
				return string.replace(/\d/g, function (match) {
					return symbolMap[match];
				}).replace(/,/g, 'ØŒ');
			},
			ordinal : '%dÙ…',
			week : {
				dow : 6, // Saturday is the first day of the week.
				doy : 12 // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : finnish (fi)
// author : Tarmo Aidantausta : https://github.com/bleadof

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var numbers_past = 'nolla yksi kaksi kolme neljÃ¤ viisi kuusi seitsemÃ¤n kahdeksan yhdeksÃ¤n'.split(' '),
			numbers_future = ['nolla', 'yhden', 'kahden', 'kolmen', 'neljÃ¤n', 'viiden', 'kuuden',
				numbers_past[7], numbers_past[8], numbers_past[9]];

		function translate(number, withoutSuffix, key, isFuture) {
			var result = "";
			switch (key) {
				case 's':
					return isFuture ? 'muutaman sekunnin' : 'muutama sekunti';
				case 'm':
					return isFuture ? 'minuutin' : 'minuutti';
				case 'mm':
					result = isFuture ? 'minuutin' : 'minuuttia';
					break;
				case 'h':
					return isFuture ? 'tunnin' : 'tunti';
				case 'hh':
					result = isFuture ? 'tunnin' : 'tuntia';
					break;
				case 'd':
					return isFuture ? 'pÃ¤ivÃ¤n' : 'pÃ¤ivÃ¤';
				case 'dd':
					result = isFuture ? 'pÃ¤ivÃ¤n' : 'pÃ¤ivÃ¤Ã¤';
					break;
				case 'M':
					return isFuture ? 'kuukauden' : 'kuukausi';
				case 'MM':
					result = isFuture ? 'kuukauden' : 'kuukautta';
					break;
				case 'y':
					return isFuture ? 'vuoden' : 'vuosi';
				case 'yy':
					result = isFuture ? 'vuoden' : 'vuotta';
					break;
			}
			result = verbal_number(number, isFuture) + " " + result;
			return result;
		}

		function verbal_number(number, isFuture) {
			return number < 10 ? (isFuture ? numbers_future[number] : numbers_past[number]) : number;
		}

		return moment.lang('fi', {
			months : "tammikuu_helmikuu_maaliskuu_huhtikuu_toukokuu_kesÃ¤kuu_heinÃ¤kuu_elokuu_syyskuu_lokakuu_marraskuu_joulukuu".split("_"),
			monthsShort : "tammi_helmi_maalis_huhti_touko_kesÃ¤_heinÃ¤_elo_syys_loka_marras_joulu".split("_"),
			weekdays : "sunnuntai_maanantai_tiistai_keskiviikko_torstai_perjantai_lauantai".split("_"),
			weekdaysShort : "su_ma_ti_ke_to_pe_la".split("_"),
			weekdaysMin : "su_ma_ti_ke_to_pe_la".split("_"),
			longDateFormat : {
				LT : "HH.mm",
				L : "DD.MM.YYYY",
				LL : "Do MMMM[ta] YYYY",
				LLL : "Do MMMM[ta] YYYY, [klo] LT",
				LLLL : "dddd, Do MMMM[ta] YYYY, [klo] LT",
				l : "D.M.YYYY",
				ll : "Do MMM YYYY",
				lll : "Do MMM YYYY, [klo] LT",
				llll : "ddd, Do MMM YYYY, [klo] LT"
			},
			calendar : {
				sameDay : '[tÃ¤nÃ¤Ã¤n] [klo] LT',
				nextDay : '[huomenna] [klo] LT',
				nextWeek : 'dddd [klo] LT',
				lastDay : '[eilen] [klo] LT',
				lastWeek : '[viime] dddd[na] [klo] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s pÃ¤Ã¤stÃ¤",
				past : "%s sitten",
				s : translate,
				m : translate,
				mm : translate,
				h : translate,
				hh : translate,
				d : translate,
				dd : translate,
				M : translate,
				MM : translate,
				y : translate,
				yy : translate
			},
			ordinal : "%d.",
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : faroese (fo)
// author : Ragnar Johannesen : https://github.com/ragnar123

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('fo', {
			months : "januar_februar_mars_aprÃ­l_mai_juni_juli_august_september_oktober_november_desember".split("_"),
			monthsShort : "jan_feb_mar_apr_mai_jun_jul_aug_sep_okt_nov_des".split("_"),
			weekdays : "sunnudagur_mÃ¡nadagur_tÃ½sdagur_mikudagur_hÃ³sdagur_frÃ­ggjadagur_leygardagur".split("_"),
			weekdaysShort : "sun_mÃ¡n_tÃ½s_mik_hÃ³s_frÃ­_ley".split("_"),
			weekdaysMin : "su_mÃ¡_tÃ½_mi_hÃ³_fr_le".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D. MMMM, YYYY LT"
			},
			calendar : {
				sameDay : '[Ã dag kl.] LT',
				nextDay : '[Ã morgin kl.] LT',
				nextWeek : 'dddd [kl.] LT',
				lastDay : '[Ã gjÃ¡r kl.] LT',
				lastWeek : '[sÃ­Ã°stu] dddd [kl] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "um %s",
				past : "%s sÃ­Ã°ani",
				s : "fÃ¡ sekund",
				m : "ein minutt",
				mm : "%d minuttir",
				h : "ein tÃ­mi",
				hh : "%d tÃ­mar",
				d : "ein dagur",
				dd : "%d dagar",
				M : "ein mÃ¡naÃ°i",
				MM : "%d mÃ¡naÃ°ir",
				y : "eitt Ã¡r",
				yy : "%d Ã¡r"
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : canadian french (fr-ca)
// author : Jonathan Abourbih : https://github.com/jonbca

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('fr-ca', {
			months : "janvier_fÃ©vrier_mars_avril_mai_juin_juillet_aoÃ»t_septembre_octobre_novembre_dÃ©cembre".split("_"),
			monthsShort : "janv._fÃ©vr._mars_avr._mai_juin_juil._aoÃ»t_sept._oct._nov._dÃ©c.".split("_"),
			weekdays : "dimanche_lundi_mardi_mercredi_jeudi_vendredi_samedi".split("_"),
			weekdaysShort : "dim._lun._mar._mer._jeu._ven._sam.".split("_"),
			weekdaysMin : "Di_Lu_Ma_Me_Je_Ve_Sa".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "YYYY-MM-DD",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[Aujourd'hui Ã ] LT",
				nextDay: '[Demain Ã ] LT',
				nextWeek: 'dddd [Ã ] LT',
				lastDay: '[Hier Ã ] LT',
				lastWeek: 'dddd [dernier Ã ] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "dans %s",
				past : "il y a %s",
				s : "quelques secondes",
				m : "une minute",
				mm : "%d minutes",
				h : "une heure",
				hh : "%d heures",
				d : "un jour",
				dd : "%d jours",
				M : "un mois",
				MM : "%d mois",
				y : "un an",
				yy : "%d ans"
			},
			ordinal : function (number) {
				return number + (number === 1 ? 'er' : '');
			}
		});
	}));
// moment.js language configuration
// language : french (fr)
// author : John Fischer : https://github.com/jfroffice

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('fr', {
			months : "janvier_fÃ©vrier_mars_avril_mai_juin_juillet_aoÃ»t_septembre_octobre_novembre_dÃ©cembre".split("_"),
			monthsShort : "janv._fÃ©vr._mars_avr._mai_juin_juil._aoÃ»t_sept._oct._nov._dÃ©c.".split("_"),
			weekdays : "dimanche_lundi_mardi_mercredi_jeudi_vendredi_samedi".split("_"),
			weekdaysShort : "dim._lun._mar._mer._jeu._ven._sam.".split("_"),
			weekdaysMin : "Di_Lu_Ma_Me_Je_Ve_Sa".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[Aujourd'hui Ã ] LT",
				nextDay: '[Demain Ã ] LT',
				nextWeek: 'dddd [Ã ] LT',
				lastDay: '[Hier Ã ] LT',
				lastWeek: 'dddd [dernier Ã ] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "dans %s",
				past : "il y a %s",
				s : "quelques secondes",
				m : "une minute",
				mm : "%d minutes",
				h : "une heure",
				hh : "%d heures",
				d : "un jour",
				dd : "%d jours",
				M : "un mois",
				MM : "%d mois",
				y : "un an",
				yy : "%d ans"
			},
			ordinal : function (number) {
				return number + (number === 1 ? 'er' : '');
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : galician (gl)
// author : Juan G. Hurtado : https://github.com/juanghurtado

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('gl', {
			months : "Xaneiro_Febreiro_Marzo_Abril_Maio_XuÃ±o_Xullo_Agosto_Setembro_Outubro_Novembro_Decembro".split("_"),
			monthsShort : "Xan._Feb._Mar._Abr._Mai._XuÃ±._Xul._Ago._Set._Out._Nov._Dec.".split("_"),
			weekdays : "Domingo_Luns_Martes_MÃ©rcores_Xoves_Venres_SÃ¡bado".split("_"),
			weekdaysShort : "Dom._Lun._Mar._MÃ©r._Xov._Ven._SÃ¡b.".split("_"),
			weekdaysMin : "Do_Lu_Ma_MÃ©_Xo_Ve_SÃ¡".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay : function () {
					return '[hoxe ' + ((this.hours() !== 1) ? 'Ã¡s' : 'Ã¡') + '] LT';
				},
				nextDay : function () {
					return '[maÃ±Ã¡ ' + ((this.hours() !== 1) ? 'Ã¡s' : 'Ã¡') + '] LT';
				},
				nextWeek : function () {
					return 'dddd [' + ((this.hours() !== 1) ? 'Ã¡s' : 'a') + '] LT';
				},
				lastDay : function () {
					return '[onte ' + ((this.hours() !== 1) ? 'Ã¡' : 'a') + '] LT';
				},
				lastWeek : function () {
					return '[o] dddd [pasado ' + ((this.hours() !== 1) ? 'Ã¡s' : 'a') + '] LT';
				},
				sameElse : 'L'
			},
			relativeTime : {
				future : function (str) {
					if (str === "uns segundos") {
						return "nuns segundos";
					}
					return "en " + str;
				},
				past : "hai %s",
				s : "uns segundos",
				m : "un minuto",
				mm : "%d minutos",
				h : "unha hora",
				hh : "%d horas",
				d : "un dÃ­a",
				dd : "%d dÃ­as",
				M : "un mes",
				MM : "%d meses",
				y : "un ano",
				yy : "%d anos"
			},
			ordinal : '%dÂº',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Hebrew (he)
// author : Tomer Cohen : https://github.com/tomer
// author : Moshe Simantov : https://github.com/DevelopmentIL
// author : Tal Ater : https://github.com/TalAter

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('he', {
			months : "×™× ×•××¨_×¤×‘×¨×•××¨_×ž×¨×¥_××¤×¨×™×œ_×ž××™_×™×•× ×™_×™×•×œ×™_××•×’×•×¡×˜_×¡×¤×˜×ž×‘×¨_××•×§×˜×•×‘×¨_× ×•×‘×ž×‘×¨_×“×¦×ž×‘×¨".split("_"),
			monthsShort : "×™× ×•×³_×¤×‘×¨×³_×ž×¨×¥_××¤×¨×³_×ž××™_×™×•× ×™_×™×•×œ×™_××•×’×³_×¡×¤×˜×³_××•×§×³_× ×•×‘×³_×“×¦×ž×³".split("_"),
			weekdays : "×¨××©×•×Ÿ_×©× ×™_×©×œ×™×©×™_×¨×‘×™×¢×™_×—×ž×™×©×™_×©×™×©×™_×©×‘×ª".split("_"),
			weekdaysShort : "××³_×‘×³_×’×³_×“×³_×”×³_×•×³_×©×³".split("_"),
			weekdaysMin : "×_×‘_×’_×“_×”_×•_×©".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D [×‘]MMMM YYYY",
				LLL : "D [×‘]MMMM YYYY LT",
				LLLL : "dddd, D [×‘]MMMM YYYY LT",
				l : "D/M/YYYY",
				ll : "D MMM YYYY",
				lll : "D MMM YYYY LT",
				llll : "ddd, D MMM YYYY LT"
			},
			calendar : {
				sameDay : '[×”×™×•× ×‘Ö¾]LT',
				nextDay : '[×ž×—×¨ ×‘Ö¾]LT',
				nextWeek : 'dddd [×‘×©×¢×”] LT',
				lastDay : '[××ª×ž×•×œ ×‘Ö¾]LT',
				lastWeek : '[×‘×™×•×] dddd [×”××—×¨×•×Ÿ ×‘×©×¢×”] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "×‘×¢×•×“ %s",
				past : "×œ×¤× ×™ %s",
				s : "×ž×¡×¤×¨ ×©× ×™×•×ª",
				m : "×“×§×”",
				mm : "%d ×“×§×•×ª",
				h : "×©×¢×”",
				hh : function (number) {
					if (number === 2) {
						return "×©×¢×ª×™×™×";
					}
					return number + " ×©×¢×•×ª";
				},
				d : "×™×•×",
				dd : function (number) {
					if (number === 2) {
						return "×™×•×ž×™×™×";
					}
					return number + " ×™×ž×™×";
				},
				M : "×—×•×“×©",
				MM : function (number) {
					if (number === 2) {
						return "×—×•×“×©×™×™×";
					}
					return number + " ×—×•×“×©×™×";
				},
				y : "×©× ×”",
				yy : function (number) {
					if (number === 2) {
						return "×©× ×ª×™×™×";
					}
					return number + " ×©× ×™×";
				}
			}
		});
	}));
// moment.js language configuration
// language : hindi (hi)
// author : Mayank Singhal : https://github.com/mayanksinghal

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var symbolMap = {
				'1': 'à¥§',
				'2': 'à¥¨',
				'3': 'à¥©',
				'4': 'à¥ª',
				'5': 'à¥«',
				'6': 'à¥¬',
				'7': 'à¥­',
				'8': 'à¥®',
				'9': 'à¥¯',
				'0': 'à¥¦'
			},
			numberMap = {
				'à¥§': '1',
				'à¥¨': '2',
				'à¥©': '3',
				'à¥ª': '4',
				'à¥«': '5',
				'à¥¬': '6',
				'à¥­': '7',
				'à¥®': '8',
				'à¥¯': '9',
				'à¥¦': '0'
			};

		return moment.lang('hi', {
			months : 'à¤œà¤¨à¤µà¤°à¥€_à¤«à¤¼à¤°à¤µà¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¥ˆà¤²_à¤®à¤ˆ_à¤œà¥‚à¤¨_à¤œà¥à¤²à¤¾à¤ˆ_à¤…à¤—à¤¸à¥à¤¤_à¤¸à¤¿à¤¤à¤®à¥à¤¬à¤°_à¤…à¤•à¥à¤Ÿà¥‚à¤¬à¤°_à¤¨à¤µà¤®à¥à¤¬à¤°_à¤¦à¤¿à¤¸à¤®à¥à¤¬à¤°'.split("_"),
			monthsShort : 'à¤œà¤¨._à¤«à¤¼à¤°._à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¥ˆ._à¤®à¤ˆ_à¤œà¥‚à¤¨_à¤œà¥à¤²._à¤…à¤—._à¤¸à¤¿à¤¤._à¤…à¤•à¥à¤Ÿà¥‚._à¤¨à¤µ._à¤¦à¤¿à¤¸.'.split("_"),
			weekdays : 'à¤°à¤µà¤¿à¤µà¤¾à¤°_à¤¸à¥‹à¤®à¤µà¤¾à¤°_à¤®à¤‚à¤—à¤²à¤µà¤¾à¤°_à¤¬à¥à¤§à¤µà¤¾à¤°_à¤—à¥à¤°à¥‚à¤µà¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤µà¤¾à¤°_à¤¶à¤¨à¤¿à¤µà¤¾à¤°'.split("_"),
			weekdaysShort : 'à¤°à¤µà¤¿_à¤¸à¥‹à¤®_à¤®à¤‚à¤—à¤²_à¤¬à¥à¤§_à¤—à¥à¤°à¥‚_à¤¶à¥à¤•à¥à¤°_à¤¶à¤¨à¤¿'.split("_"),
			weekdaysMin : 'à¤°_à¤¸à¥‹_à¤®à¤‚_à¤¬à¥_à¤—à¥_à¤¶à¥_à¤¶'.split("_"),
			longDateFormat : {
				LT : "A h:mm à¤¬à¤œà¥‡",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY, LT",
				LLLL : "dddd, D MMMM YYYY, LT"
			},
			calendar : {
				sameDay : '[à¤†à¤œ] LT',
				nextDay : '[à¤•à¤²] LT',
				nextWeek : 'dddd, LT',
				lastDay : '[à¤•à¤²] LT',
				lastWeek : '[à¤ªà¤¿à¤›à¤²à¥‡] dddd, LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s à¤®à¥‡à¤‚",
				past : "%s à¤ªà¤¹à¤²à¥‡",
				s : "à¤•à¥à¤› à¤¹à¥€ à¤•à¥à¤·à¤£",
				m : "à¤à¤• à¤®à¤¿à¤¨à¤Ÿ",
				mm : "%d à¤®à¤¿à¤¨à¤Ÿ",
				h : "à¤à¤• à¤˜à¤‚à¤Ÿà¤¾",
				hh : "%d à¤˜à¤‚à¤Ÿà¥‡",
				d : "à¤à¤• à¤¦à¤¿à¤¨",
				dd : "%d à¤¦à¤¿à¤¨",
				M : "à¤à¤• à¤®à¤¹à¥€à¤¨à¥‡",
				MM : "%d à¤®à¤¹à¥€à¤¨à¥‡",
				y : "à¤à¤• à¤µà¤°à¥à¤·",
				yy : "%d à¤µà¤°à¥à¤·"
			},
			preparse: function (string) {
				return string.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g, function (match) {
					return numberMap[match];
				});
			},
			postformat: function (string) {
				return string.replace(/\d/g, function (match) {
					return symbolMap[match];
				});
			},
			// Hindi notation for meridiems are quite fuzzy in practice. While there exists
			// a rigid notion of a 'Pahar' it is not used as rigidly in modern Hindi.
			meridiem : function (hour, minute, isLower) {
				if (hour < 4) {
					return "à¤°à¤¾à¤¤";
				} else if (hour < 10) {
					return "à¤¸à¥à¤¬à¤¹";
				} else if (hour < 17) {
					return "à¤¦à¥‹à¤ªà¤¹à¤°";
				} else if (hour < 20) {
					return "à¤¶à¤¾à¤®";
				} else {
					return "à¤°à¤¾à¤¤";
				}
			},
			week : {
				dow : 0, // Sunday is the first day of the week.
				doy : 6  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : hrvatski (hr)
// author : Bojan MarkoviÄ‡ : https://github.com/bmarkovic

// based on (sl) translation by Robert SedovÅ¡ek

	(function (factory) {
		factory(moment);
	}(function (moment) {

		function translate(number, withoutSuffix, key) {
			var result = number + " ";
			switch (key) {
				case 'm':
					return withoutSuffix ? 'jedna minuta' : 'jedne minute';
				case 'mm':
					if (number === 1) {
						result += 'minuta';
					} else if (number === 2 || number === 3 || number === 4) {
						result += 'minute';
					} else {
						result += 'minuta';
					}
					return result;
				case 'h':
					return withoutSuffix ? 'jedan sat' : 'jednog sata';
				case 'hh':
					if (number === 1) {
						result += 'sat';
					} else if (number === 2 || number === 3 || number === 4) {
						result += 'sata';
					} else {
						result += 'sati';
					}
					return result;
				case 'dd':
					if (number === 1) {
						result += 'dan';
					} else {
						result += 'dana';
					}
					return result;
				case 'MM':
					if (number === 1) {
						result += 'mjesec';
					} else if (number === 2 || number === 3 || number === 4) {
						result += 'mjeseca';
					} else {
						result += 'mjeseci';
					}
					return result;
				case 'yy':
					if (number === 1) {
						result += 'godina';
					} else if (number === 2 || number === 3 || number === 4) {
						result += 'godine';
					} else {
						result += 'godina';
					}
					return result;
			}
		}

		return moment.lang('hr', {
			months : "sjeÄanj_veljaÄa_oÅ¾ujak_travanj_svibanj_lipanj_srpanj_kolovoz_rujan_listopad_studeni_prosinac".split("_"),
			monthsShort : "sje._vel._oÅ¾u._tra._svi._lip._srp._kol._ruj._lis._stu._pro.".split("_"),
			weekdays : "nedjelja_ponedjeljak_utorak_srijeda_Äetvrtak_petak_subota".split("_"),
			weekdaysShort : "ned._pon._uto._sri._Äet._pet._sub.".split("_"),
			weekdaysMin : "ne_po_ut_sr_Äe_pe_su".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "DD. MM. YYYY",
				LL : "D. MMMM YYYY",
				LLL : "D. MMMM YYYY LT",
				LLLL : "dddd, D. MMMM YYYY LT"
			},
			calendar : {
				sameDay  : '[danas u] LT',
				nextDay  : '[sutra u] LT',

				nextWeek : function () {
					switch (this.day()) {
						case 0:
							return '[u] [nedjelju] [u] LT';
						case 3:
							return '[u] [srijedu] [u] LT';
						case 6:
							return '[u] [subotu] [u] LT';
						case 1:
						case 2:
						case 4:
						case 5:
							return '[u] dddd [u] LT';
					}
				},
				lastDay  : '[juÄer u] LT',
				lastWeek : function () {
					switch (this.day()) {
						case 0:
						case 3:
							return '[proÅ¡lu] dddd [u] LT';
						case 6:
							return '[proÅ¡le] [subote] [u] LT';
						case 1:
						case 2:
						case 4:
						case 5:
							return '[proÅ¡li] dddd [u] LT';
					}
				},
				sameElse : 'L'
			},
			relativeTime : {
				future : "za %s",
				past   : "prije %s",
				s      : "par sekundi",
				m      : translate,
				mm     : translate,
				h      : translate,
				hh     : translate,
				d      : "dan",
				dd     : translate,
				M      : "mjesec",
				MM     : translate,
				y      : "godinu",
				yy     : translate
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : hungarian (hu)
// author : Adam Brunner : https://github.com/adambrunner

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var weekEndings = 'vasÃ¡rnap hÃ©tfÅ‘n kedden szerdÃ¡n csÃ¼tÃ¶rtÃ¶kÃ¶n pÃ©nteken szombaton'.split(' ');

		function translate(number, withoutSuffix, key, isFuture) {
			var num = number,
				suffix;

			switch (key) {
				case 's':
					return (isFuture || withoutSuffix) ? 'nÃ©hÃ¡ny mÃ¡sodperc' : 'nÃ©hÃ¡ny mÃ¡sodperce';
				case 'm':
					return 'egy' + (isFuture || withoutSuffix ? ' perc' : ' perce');
				case 'mm':
					return num + (isFuture || withoutSuffix ? ' perc' : ' perce');
				case 'h':
					return 'egy' + (isFuture || withoutSuffix ? ' Ã³ra' : ' Ã³rÃ¡ja');
				case 'hh':
					return num + (isFuture || withoutSuffix ? ' Ã³ra' : ' Ã³rÃ¡ja');
				case 'd':
					return 'egy' + (isFuture || withoutSuffix ? ' nap' : ' napja');
				case 'dd':
					return num + (isFuture || withoutSuffix ? ' nap' : ' napja');
				case 'M':
					return 'egy' + (isFuture || withoutSuffix ? ' hÃ³nap' : ' hÃ³napja');
				case 'MM':
					return num + (isFuture || withoutSuffix ? ' hÃ³nap' : ' hÃ³napja');
				case 'y':
					return 'egy' + (isFuture || withoutSuffix ? ' Ã©v' : ' Ã©ve');
				case 'yy':
					return num + (isFuture || withoutSuffix ? ' Ã©v' : ' Ã©ve');
			}

			return '';
		}

		function week(isFuture) {
			return (isFuture ? '' : '[mÃºlt] ') + '[' + weekEndings[this.day()] + '] LT[-kor]';
		}

		return moment.lang('hu', {
			months : "januÃ¡r_februÃ¡r_mÃ¡rcius_Ã¡prilis_mÃ¡jus_jÃºnius_jÃºlius_augusztus_szeptember_oktÃ³ber_november_december".split("_"),
			monthsShort : "jan_feb_mÃ¡rc_Ã¡pr_mÃ¡j_jÃºn_jÃºl_aug_szept_okt_nov_dec".split("_"),
			weekdays : "vasÃ¡rnap_hÃ©tfÅ‘_kedd_szerda_csÃ¼tÃ¶rtÃ¶k_pÃ©ntek_szombat".split("_"),
			weekdaysShort : "vas_hÃ©t_kedd_sze_csÃ¼t_pÃ©n_szo".split("_"),
			weekdaysMin : "v_h_k_sze_cs_p_szo".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "YYYY.MM.DD.",
				LL : "YYYY. MMMM D.",
				LLL : "YYYY. MMMM D., LT",
				LLLL : "YYYY. MMMM D., dddd LT"
			},
			calendar : {
				sameDay : '[ma] LT[-kor]',
				nextDay : '[holnap] LT[-kor]',
				nextWeek : function () {
					return week.call(this, true);
				},
				lastDay : '[tegnap] LT[-kor]',
				lastWeek : function () {
					return week.call(this, false);
				},
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s mÃºlva",
				past : "%s",
				s : translate,
				m : translate,
				mm : translate,
				h : translate,
				hh : translate,
				d : translate,
				dd : translate,
				M : translate,
				MM : translate,
				y : translate,
				yy : translate
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Bahasa Indonesia (id)
// author : Mohammad Satrio Utomo : https://github.com/tyok
// reference: http://id.wikisource.org/wiki/Pedoman_Umum_Ejaan_Bahasa_Indonesia_yang_Disempurnakan

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('id', {
			months : "Januari_Februari_Maret_April_Mei_Juni_Juli_Agustus_September_Oktober_November_Desember".split("_"),
			monthsShort : "Jan_Feb_Mar_Apr_Mei_Jun_Jul_Ags_Sep_Okt_Nov_Des".split("_"),
			weekdays : "Minggu_Senin_Selasa_Rabu_Kamis_Jumat_Sabtu".split("_"),
			weekdaysShort : "Min_Sen_Sel_Rab_Kam_Jum_Sab".split("_"),
			weekdaysMin : "Mg_Sn_Sl_Rb_Km_Jm_Sb".split("_"),
			longDateFormat : {
				LT : "HH.mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY [pukul] LT",
				LLLL : "dddd, D MMMM YYYY [pukul] LT"
			},
			meridiem : function (hours, minutes, isLower) {
				if (hours < 11) {
					return 'pagi';
				} else if (hours < 15) {
					return 'siang';
				} else if (hours < 19) {
					return 'sore';
				} else {
					return 'malam';
				}
			},
			calendar : {
				sameDay : '[Hari ini pukul] LT',
				nextDay : '[Besok pukul] LT',
				nextWeek : 'dddd [pukul] LT',
				lastDay : '[Kemarin pukul] LT',
				lastWeek : 'dddd [lalu pukul] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "dalam %s",
				past : "%s yang lalu",
				s : "beberapa detik",
				m : "semenit",
				mm : "%d menit",
				h : "sejam",
				hh : "%d jam",
				d : "sehari",
				dd : "%d hari",
				M : "sebulan",
				MM : "%d bulan",
				y : "setahun",
				yy : "%d tahun"
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : icelandic (is)
// author : Hinrik Ã–rn SigurÃ°sson : https://github.com/hinrik

	(function (factory) {
		factory(moment);
	}(function (moment) {
		function plural(n) {
			if (n % 100 === 11) {
				return true;
			} else if (n % 10 === 1) {
				return false;
			}
			return true;
		}

		function translate(number, withoutSuffix, key, isFuture) {
			var result = number + " ";
			switch (key) {
				case 's':
					return withoutSuffix || isFuture ? 'nokkrar sekÃºndur' : 'nokkrum sekÃºndum';
				case 'm':
					return withoutSuffix ? 'mÃ­nÃºta' : 'mÃ­nÃºtu';
				case 'mm':
					if (plural(number)) {
						return result + (withoutSuffix || isFuture ? 'mÃ­nÃºtur' : 'mÃ­nÃºtum');
					} else if (withoutSuffix) {
						return result + 'mÃ­nÃºta';
					}
					return result + 'mÃ­nÃºtu';
				case 'hh':
					if (plural(number)) {
						return result + (withoutSuffix || isFuture ? 'klukkustundir' : 'klukkustundum');
					}
					return result + 'klukkustund';
				case 'd':
					if (withoutSuffix) {
						return 'dagur';
					}
					return isFuture ? 'dag' : 'degi';
				case 'dd':
					if (plural(number)) {
						if (withoutSuffix) {
							return result + 'dagar';
						}
						return result + (isFuture ? 'daga' : 'dÃ¶gum');
					} else if (withoutSuffix) {
						return result + 'dagur';
					}
					return result + (isFuture ? 'dag' : 'degi');
				case 'M':
					if (withoutSuffix) {
						return 'mÃ¡nuÃ°ur';
					}
					return isFuture ? 'mÃ¡nuÃ°' : 'mÃ¡nuÃ°i';
				case 'MM':
					if (plural(number)) {
						if (withoutSuffix) {
							return result + 'mÃ¡nuÃ°ir';
						}
						return result + (isFuture ? 'mÃ¡nuÃ°i' : 'mÃ¡nuÃ°um');
					} else if (withoutSuffix) {
						return result + 'mÃ¡nuÃ°ur';
					}
					return result + (isFuture ? 'mÃ¡nuÃ°' : 'mÃ¡nuÃ°i');
				case 'y':
					return withoutSuffix || isFuture ? 'Ã¡r' : 'Ã¡ri';
				case 'yy':
					if (plural(number)) {
						return result + (withoutSuffix || isFuture ? 'Ã¡r' : 'Ã¡rum');
					}
					return result + (withoutSuffix || isFuture ? 'Ã¡r' : 'Ã¡ri');
			}
		}

		return moment.lang('is', {
			months : "janÃºar_febrÃºar_mars_aprÃ­l_maÃ­_jÃºnÃ­_jÃºlÃ­_Ã¡gÃºst_september_oktÃ³ber_nÃ³vember_desember".split("_"),
			monthsShort : "jan_feb_mar_apr_maÃ­_jÃºn_jÃºl_Ã¡gÃº_sep_okt_nÃ³v_des".split("_"),
			weekdays : "sunnudagur_mÃ¡nudagur_Ã¾riÃ°judagur_miÃ°vikudagur_fimmtudagur_fÃ¶studagur_laugardagur".split("_"),
			weekdaysShort : "sun_mÃ¡n_Ã¾ri_miÃ°_fim_fÃ¶s_lau".split("_"),
			weekdaysMin : "Su_MÃ¡_Ãžr_Mi_Fi_FÃ¶_La".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "DD/MM/YYYY",
				LL : "D. MMMM YYYY",
				LLL : "D. MMMM YYYY [kl.] LT",
				LLLL : "dddd, D. MMMM YYYY [kl.] LT"
			},
			calendar : {
				sameDay : '[Ã­ dag kl.] LT',
				nextDay : '[Ã¡ morgun kl.] LT',
				nextWeek : 'dddd [kl.] LT',
				lastDay : '[Ã­ gÃ¦r kl.] LT',
				lastWeek : '[sÃ­Ã°asta] dddd [kl.] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "eftir %s",
				past : "fyrir %s sÃ­Ã°an",
				s : translate,
				m : translate,
				mm : translate,
				h : "klukkustund",
				hh : translate,
				d : translate,
				dd : translate,
				M : translate,
				MM : translate,
				y : translate,
				yy : translate
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : italian (it)
// author : Lorenzo : https://github.com/aliem
// author: Mattia Larentis: https://github.com/nostalgiaz

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('it', {
			months : "Gennaio_Febbraio_Marzo_Aprile_Maggio_Giugno_Luglio_Agosto_Settembre_Ottobre_Novembre_Dicembre".split("_"),
			monthsShort : "Gen_Feb_Mar_Apr_Mag_Giu_Lug_Ago_Set_Ott_Nov_Dic".split("_"),
			weekdays : "Domenica_LunedÃ¬_MartedÃ¬_MercoledÃ¬_GiovedÃ¬_VenerdÃ¬_Sabato".split("_"),
			weekdaysShort : "Dom_Lun_Mar_Mer_Gio_Ven_Sab".split("_"),
			weekdaysMin : "D_L_Ma_Me_G_V_S".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendar : {
				sameDay: '[Oggi alle] LT',
				nextDay: '[Domani alle] LT',
				nextWeek: 'dddd [alle] LT',
				lastDay: '[Ieri alle] LT',
				lastWeek: '[lo scorso] dddd [alle] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : function (s) {
					return ((/^[0-9].+$/).test(s) ? "tra" : "in") + " " + s;
				},
				past : "%s fa",
				s : "secondi",
				m : "un minuto",
				mm : "%d minuti",
				h : "un'ora",
				hh : "%d ore",
				d : "un giorno",
				dd : "%d giorni",
				M : "un mese",
				MM : "%d mesi",
				y : "un anno",
				yy : "%d anni"
			},
			ordinal: '%dÂº',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : japanese (ja)
// author : LI Long : https://github.com/baryon

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('ja', {
			months : "1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),
			monthsShort : "1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),
			weekdays : "æ—¥æ›œæ—¥_æœˆæ›œæ—¥_ç«æ›œæ—¥_æ°´æ›œæ—¥_æœ¨æ›œæ—¥_é‡‘æ›œæ—¥_åœŸæ›œæ—¥".split("_"),
			weekdaysShort : "æ—¥_æœˆ_ç«_æ°´_æœ¨_é‡‘_åœŸ".split("_"),
			weekdaysMin : "æ—¥_æœˆ_ç«_æ°´_æœ¨_é‡‘_åœŸ".split("_"),
			longDateFormat : {
				LT : "Ahæ™‚måˆ†",
				L : "YYYY/MM/DD",
				LL : "YYYYå¹´MæœˆDæ—¥",
				LLL : "YYYYå¹´MæœˆDæ—¥LT",
				LLLL : "YYYYå¹´MæœˆDæ—¥LT dddd"
			},
			meridiem : function (hour, minute, isLower) {
				if (hour < 12) {
					return "åˆå‰";
				} else {
					return "åˆå¾Œ";
				}
			},
			calendar : {
				sameDay : '[ä»Šæ—¥] LT',
				nextDay : '[æ˜Žæ—¥] LT',
				nextWeek : '[æ¥é€±]dddd LT',
				lastDay : '[æ˜¨æ—¥] LT',
				lastWeek : '[å‰é€±]dddd LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%så¾Œ",
				past : "%så‰",
				s : "æ•°ç§’",
				m : "1åˆ†",
				mm : "%dåˆ†",
				h : "1æ™‚é–“",
				hh : "%dæ™‚é–“",
				d : "1æ—¥",
				dd : "%dæ—¥",
				M : "1ãƒ¶æœˆ",
				MM : "%dãƒ¶æœˆ",
				y : "1å¹´",
				yy : "%då¹´"
			}
		});
	}));
// moment.js language configuration
// language : Georgian (ka)
// author : Irakli Janiashvili : https://github.com/irakli-janiashvili

	(function (factory) {
		factory(moment);
	}(function (moment) {

		function monthsCaseReplace(m, format) {
			var months = {
					'nominative': 'áƒ˜áƒáƒœáƒ•áƒáƒ áƒ˜_áƒ—áƒ”áƒ‘áƒ”áƒ áƒ•áƒáƒšáƒ˜_áƒ›áƒáƒ áƒ¢áƒ˜_áƒáƒžáƒ áƒ˜áƒšáƒ˜_áƒ›áƒáƒ˜áƒ¡áƒ˜_áƒ˜áƒ•áƒœáƒ˜áƒ¡áƒ˜_áƒ˜áƒ•áƒšáƒ˜áƒ¡áƒ˜_áƒáƒ’áƒ•áƒ˜áƒ¡áƒ¢áƒ_áƒ¡áƒ”áƒ¥áƒ¢áƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜_áƒáƒ¥áƒ¢áƒáƒ›áƒ‘áƒ”áƒ áƒ˜_áƒœáƒáƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜_áƒ“áƒ”áƒ™áƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜'.split('_'),
					'accusative': 'áƒ˜áƒáƒœáƒ•áƒáƒ áƒ¡_áƒ—áƒ”áƒ‘áƒ”áƒ áƒ•áƒáƒšáƒ¡_áƒ›áƒáƒ áƒ¢áƒ¡_áƒáƒžáƒ áƒ˜áƒšáƒ˜áƒ¡_áƒ›áƒáƒ˜áƒ¡áƒ¡_áƒ˜áƒ•áƒœáƒ˜áƒ¡áƒ¡_áƒ˜áƒ•áƒšáƒ˜áƒ¡áƒ¡_áƒáƒ’áƒ•áƒ˜áƒ¡áƒ¢áƒ¡_áƒ¡áƒ”áƒ¥áƒ¢áƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡_áƒáƒ¥áƒ¢áƒáƒ›áƒ‘áƒ”áƒ áƒ¡_áƒœáƒáƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡_áƒ“áƒ”áƒ™áƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡'.split('_')
				},

				nounCase = (/D[oD] *MMMM?/).test(format) ?
					'accusative' :
					'nominative';

			return months[nounCase][m.month()];
		}

		function weekdaysCaseReplace(m, format) {
			var weekdays = {
					'nominative': 'áƒ™áƒ•áƒ˜áƒ áƒ_áƒáƒ áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒ¡áƒáƒ›áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒáƒ—áƒ®áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒ®áƒ£áƒ—áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒžáƒáƒ áƒáƒ¡áƒ™áƒ”áƒ•áƒ˜_áƒ¨áƒáƒ‘áƒáƒ—áƒ˜'.split('_'),
					'accusative': 'áƒ™áƒ•áƒ˜áƒ áƒáƒ¡_áƒáƒ áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒ¡áƒáƒ›áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒáƒ—áƒ®áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒ®áƒ£áƒ—áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒžáƒáƒ áƒáƒ¡áƒ™áƒ”áƒ•áƒ¡_áƒ¨áƒáƒ‘áƒáƒ—áƒ¡'.split('_')
				},

				nounCase = (/(áƒ¬áƒ˜áƒœáƒ|áƒ¨áƒ”áƒ›áƒ“áƒ”áƒ’)/).test(format) ?
					'accusative' :
					'nominative';

			return weekdays[nounCase][m.day()];
		}

		return moment.lang('ka', {
			months : monthsCaseReplace,
			monthsShort : "áƒ˜áƒáƒœ_áƒ—áƒ”áƒ‘_áƒ›áƒáƒ _áƒáƒžáƒ _áƒ›áƒáƒ˜_áƒ˜áƒ•áƒœ_áƒ˜áƒ•áƒš_áƒáƒ’áƒ•_áƒ¡áƒ”áƒ¥_áƒáƒ¥áƒ¢_áƒœáƒáƒ”_áƒ“áƒ”áƒ™".split("_"),
			weekdays : weekdaysCaseReplace,
			weekdaysShort : "áƒ™áƒ•áƒ˜_áƒáƒ áƒ¨_áƒ¡áƒáƒ›_áƒáƒ—áƒ®_áƒ®áƒ£áƒ—_áƒžáƒáƒ _áƒ¨áƒáƒ‘".split("_"),
			weekdaysMin : "áƒ™áƒ•_áƒáƒ _áƒ¡áƒ_áƒáƒ—_áƒ®áƒ£_áƒžáƒ_áƒ¨áƒ".split("_"),
			longDateFormat : {
				LT : "h:mm A",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendar : {
				sameDay : '[áƒ“áƒ¦áƒ”áƒ¡] LT[-áƒ–áƒ”]',
				nextDay : '[áƒ®áƒ•áƒáƒš] LT[-áƒ–áƒ”]',
				lastDay : '[áƒ’áƒ£áƒ¨áƒ˜áƒœ] LT[-áƒ–áƒ”]',
				nextWeek : '[áƒ¨áƒ”áƒ›áƒ“áƒ”áƒ’] dddd LT[-áƒ–áƒ”]',
				lastWeek : '[áƒ¬áƒ˜áƒœáƒ] dddd LT-áƒ–áƒ”',
				sameElse : 'L'
			},
			relativeTime : {
				future : function (s) {
					return (/(áƒ¬áƒáƒ›áƒ˜|áƒ¬áƒ£áƒ—áƒ˜|áƒ¡áƒáƒáƒ—áƒ˜|áƒ¬áƒ”áƒšáƒ˜)/).test(s) ?
						s.replace(/áƒ˜$/, "áƒ¨áƒ˜") :
						s + "áƒ¨áƒ˜";
				},
				past : function (s) {
					if ((/(áƒ¬áƒáƒ›áƒ˜|áƒ¬áƒ£áƒ—áƒ˜|áƒ¡áƒáƒáƒ—áƒ˜|áƒ“áƒ¦áƒ”|áƒ—áƒ•áƒ”)/).test(s)) {
						return s.replace(/(áƒ˜|áƒ”)$/, "áƒ˜áƒ¡ áƒ¬áƒ˜áƒœ");
					}
					if ((/áƒ¬áƒ”áƒšáƒ˜/).test(s)) {
						return s.replace(/áƒ¬áƒ”áƒšáƒ˜$/, "áƒ¬áƒšáƒ˜áƒ¡ áƒ¬áƒ˜áƒœ");
					}
				},
				s : "áƒ áƒáƒ›áƒ“áƒ”áƒœáƒ˜áƒ›áƒ” áƒ¬áƒáƒ›áƒ˜",
				m : "áƒ¬áƒ£áƒ—áƒ˜",
				mm : "%d áƒ¬áƒ£áƒ—áƒ˜",
				h : "áƒ¡áƒáƒáƒ—áƒ˜",
				hh : "%d áƒ¡áƒáƒáƒ—áƒ˜",
				d : "áƒ“áƒ¦áƒ”",
				dd : "%d áƒ“áƒ¦áƒ”",
				M : "áƒ—áƒ•áƒ”",
				MM : "%d áƒ—áƒ•áƒ”",
				y : "áƒ¬áƒ”áƒšáƒ˜",
				yy : "%d áƒ¬áƒ”áƒšáƒ˜"
			},
			ordinal : function (number) {
				if (number === 0) {
					return number;
				}

				if (number === 1) {
					return number + "-áƒšáƒ˜";
				}

				if ((number < 20) || (number <= 100 && (number % 20 === 0)) || (number % 100 === 0)) {
					return "áƒ›áƒ”-" + number;
				}

				return number + "-áƒ”";
			},
			week : {
				dow : 1,
				doy : 7
			}
		});
	}));
// moment.js language configuration
// language : korean (ko)
// author : Kyungwook, Park : https://github.com/kyungw00k

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('ko', {
			months : "1ì›”_2ì›”_3ì›”_4ì›”_5ì›”_6ì›”_7ì›”_8ì›”_9ì›”_10ì›”_11ì›”_12ì›”".split("_"),
			monthsShort : "1ì›”_2ì›”_3ì›”_4ì›”_5ì›”_6ì›”_7ì›”_8ì›”_9ì›”_10ì›”_11ì›”_12ì›”".split("_"),
			weekdays : "ì¼ìš”ì¼_ì›”ìš”ì¼_í™”ìš”ì¼_ìˆ˜ìš”ì¼_ëª©ìš”ì¼_ê¸ˆìš”ì¼_í† ìš”ì¼".split("_"),
			weekdaysShort : "ì¼_ì›”_í™”_ìˆ˜_ëª©_ê¸ˆ_í† ".split("_"),
			weekdaysMin : "ì¼_ì›”_í™”_ìˆ˜_ëª©_ê¸ˆ_í† ".split("_"),
			longDateFormat : {
				LT : "A hì‹œ mmë¶„",
				L : "YYYY.MM.DD",
				LL : "YYYYë…„ MMMM Dì¼",
				LLL : "YYYYë…„ MMMM Dì¼ LT",
				LLLL : "YYYYë…„ MMMM Dì¼ dddd LT"
			},
			meridiem : function (hour, minute, isUpper) {
				return hour < 12 ? 'ì˜¤ì „' : 'ì˜¤í›„';
			},
			calendar : {
				sameDay : 'ì˜¤ëŠ˜ LT',
				nextDay : 'ë‚´ì¼ LT',
				nextWeek : 'dddd LT',
				lastDay : 'ì–´ì œ LT',
				lastWeek : 'ì§€ë‚œì£¼ dddd LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s í›„",
				past : "%s ì „",
				s : "ëª‡ì´ˆ",
				ss : "%dì´ˆ",
				m : "ì¼ë¶„",
				mm : "%dë¶„",
				h : "í•œì‹œê°„",
				hh : "%dì‹œê°„",
				d : "í•˜ë£¨",
				dd : "%dì¼",
				M : "í•œë‹¬",
				MM : "%dë‹¬",
				y : "ì¼ë…„",
				yy : "%dë…„"
			},
			ordinal : '%dì¼'
		});
	}));
// moment.js language configuration
// language : Lithuanian (lt)
// author : Mindaugas MozÅ«ras : https://github.com/mmozuras

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var units = {
				"m" : "minutÄ—_minutÄ—s_minutÄ™",
				"mm": "minutÄ—s_minuÄiÅ³_minutes",
				"h" : "valanda_valandos_valandÄ…",
				"hh": "valandos_valandÅ³_valandas",
				"d" : "diena_dienos_dienÄ…",
				"dd": "dienos_dienÅ³_dienas",
				"M" : "mÄ—nuo_mÄ—nesio_mÄ—nesÄ¯",
				"MM": "mÄ—nesiai_mÄ—nesiÅ³_mÄ—nesius",
				"y" : "metai_metÅ³_metus",
				"yy": "metai_metÅ³_metus"
			},
			weekDays = "pirmadienis_antradienis_treÄiadienis_ketvirtadienis_penktadienis_Å¡eÅ¡tadienis_sekmadienis".split("_");

		function translateSeconds(number, withoutSuffix, key, isFuture) {
			if (withoutSuffix) {
				return "kelios sekundÄ—s";
			} else {
				return isFuture ? "keliÅ³ sekundÅ¾iÅ³" : "kelias sekundes";
			}
		}

		function translateSingular(number, withoutSuffix, key, isFuture) {
			return withoutSuffix ? forms(key)[0] : (isFuture ? forms(key)[1] : forms(key)[2]);
		}

		function special(number) {
			return number % 10 === 0 || (number > 10 && number < 20);
		}

		function forms(key) {
			return units[key].split("_");
		}

		function translate(number, withoutSuffix, key, isFuture) {
			var result = number + " ";
			if (number === 1) {
				return result + translateSingular(number, withoutSuffix, key[0], isFuture);
			} else if (withoutSuffix) {
				return result + (special(number) ? forms(key)[1] : forms(key)[0]);
			} else {
				if (isFuture) {
					return result + forms(key)[1];
				} else {
					return result + (special(number) ? forms(key)[1] : forms(key)[2]);
				}
			}
		}

		function relativeWeekDay(moment, format) {
			var nominative = format.indexOf('dddd LT') === -1,
				weekDay = weekDays[moment.weekday()];

			return nominative ? weekDay : weekDay.substring(0, weekDay.length - 2) + "Ä¯";
		}

		return moment.lang("lt", {
			months : "sausio_vasario_kovo_balandÅ¾io_geguÅ¾Ä—s_birÅ¾Ä—lio_liepos_rugpjÅ«Äio_rugsÄ—jo_spalio_lapkriÄio_gruodÅ¾io".split("_"),
			monthsShort : "sau_vas_kov_bal_geg_bir_lie_rgp_rgs_spa_lap_grd".split("_"),
			weekdays : relativeWeekDay,
			weekdaysShort : "Sek_Pir_Ant_Tre_Ket_Pen_Å eÅ¡".split("_"),
			weekdaysMin : "S_P_A_T_K_Pn_Å ".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "YYYY-MM-DD",
				LL : "YYYY [m.] MMMM D [d.]",
				LLL : "YYYY [m.] MMMM D [d.], LT [val.]",
				LLLL : "YYYY [m.] MMMM D [d.], dddd, LT [val.]",
				l : "YYYY-MM-DD",
				ll : "YYYY [m.] MMMM D [d.]",
				lll : "YYYY [m.] MMMM D [d.], LT [val.]",
				llll : "YYYY [m.] MMMM D [d.], ddd, LT [val.]"
			},
			calendar : {
				sameDay : "[Å iandien] LT",
				nextDay : "[Rytoj] LT",
				nextWeek : "dddd LT",
				lastDay : "[Vakar] LT",
				lastWeek : "[PraÄ—jusÄ¯] dddd LT",
				sameElse : "L"
			},
			relativeTime : {
				future : "po %s",
				past : "prieÅ¡ %s",
				s : translateSeconds,
				m : translateSingular,
				mm : translate,
				h : translateSingular,
				hh : translate,
				d : translateSingular,
				dd : translate,
				M : translateSingular,
				MM : translate,
				y : translateSingular,
				yy : translate
			},
			ordinal : function (number) {
				return number + '-oji';
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : latvian (lv)
// author : Kristaps Karlsons : https://github.com/skakri

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var units = {
			'mm': 'minÅ«ti_minÅ«tes_minÅ«te_minÅ«tes',
			'hh': 'stundu_stundas_stunda_stundas',
			'dd': 'dienu_dienas_diena_dienas',
			'MM': 'mÄ“nesi_mÄ“neÅ¡us_mÄ“nesis_mÄ“neÅ¡i',
			'yy': 'gadu_gadus_gads_gadi'
		};

		function format(word, number, withoutSuffix) {
			var forms = word.split('_');
			if (withoutSuffix) {
				return number % 10 === 1 && number !== 11 ? forms[2] : forms[3];
			} else {
				return number % 10 === 1 && number !== 11 ? forms[0] : forms[1];
			}
		}

		function relativeTimeWithPlural(number, withoutSuffix, key) {
			return number + ' ' + format(units[key], number, withoutSuffix);
		}

		return moment.lang('lv', {
			months : "janvÄris_februÄris_marts_aprÄ«lis_maijs_jÅ«nijs_jÅ«lijs_augusts_septembris_oktobris_novembris_decembris".split("_"),
			monthsShort : "jan_feb_mar_apr_mai_jÅ«n_jÅ«l_aug_sep_okt_nov_dec".split("_"),
			weekdays : "svÄ“tdiena_pirmdiena_otrdiena_treÅ¡diena_ceturtdiena_piektdiena_sestdiena".split("_"),
			weekdaysShort : "Sv_P_O_T_C_Pk_S".split("_"),
			weekdaysMin : "Sv_P_O_T_C_Pk_S".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD.MM.YYYY",
				LL : "YYYY. [gada] D. MMMM",
				LLL : "YYYY. [gada] D. MMMM, LT",
				LLLL : "YYYY. [gada] D. MMMM, dddd, LT"
			},
			calendar : {
				sameDay : '[Å odien pulksten] LT',
				nextDay : '[RÄ«t pulksten] LT',
				nextWeek : 'dddd [pulksten] LT',
				lastDay : '[Vakar pulksten] LT',
				lastWeek : '[PagÄjuÅ¡Ä] dddd [pulksten] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s vÄ“lÄk",
				past : "%s agrÄk",
				s : "daÅ¾as sekundes",
				m : "minÅ«ti",
				mm : relativeTimeWithPlural,
				h : "stundu",
				hh : relativeTimeWithPlural,
				d : "dienu",
				dd : relativeTimeWithPlural,
				M : "mÄ“nesi",
				MM : relativeTimeWithPlural,
				y : "gadu",
				yy : relativeTimeWithPlural
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : malayalam (ml)
// author : Floyd Pink : https://github.com/floydpink

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('ml', {
			months : 'à´œà´¨àµà´µà´°à´¿_à´«àµ†à´¬àµà´°àµà´µà´°à´¿_à´®à´¾àµ¼à´šàµà´šàµ_à´à´ªàµà´°à´¿àµ½_à´®àµ‡à´¯àµ_à´œàµ‚àµº_à´œàµ‚à´²àµˆ_à´“à´—à´¸àµà´±àµà´±àµ_à´¸àµ†à´ªàµà´±àµà´±à´‚à´¬àµ¼_à´’à´•àµà´Ÿàµ‹à´¬àµ¼_à´¨à´µà´‚à´¬àµ¼_à´¡à´¿à´¸à´‚à´¬àµ¼'.split("_"),
			monthsShort : 'à´œà´¨àµ._à´«àµ†à´¬àµà´°àµ._à´®à´¾àµ¼._à´à´ªàµà´°à´¿._à´®àµ‡à´¯àµ_à´œàµ‚àµº_à´œàµ‚à´²àµˆ._à´“à´—._à´¸àµ†à´ªàµà´±àµà´±._à´’à´•àµà´Ÿàµ‹._à´¨à´µà´‚._à´¡à´¿à´¸à´‚.'.split("_"),
			weekdays : 'à´žà´¾à´¯à´±à´¾à´´àµà´š_à´¤à´¿à´™àµà´•à´³à´¾à´´àµà´š_à´šàµŠà´µàµà´µà´¾à´´àµà´š_à´¬àµà´§à´¨à´¾à´´àµà´š_à´µàµà´¯à´¾à´´à´¾à´´àµà´š_à´µàµ†à´³àµà´³à´¿à´¯à´¾à´´àµà´š_à´¶à´¨à´¿à´¯à´¾à´´àµà´š'.split("_"),
			weekdaysShort : 'à´žà´¾à´¯àµ¼_à´¤à´¿à´™àµà´•àµ¾_à´šàµŠà´µàµà´µ_à´¬àµà´§àµ»_à´µàµà´¯à´¾à´´à´‚_à´µàµ†à´³àµà´³à´¿_à´¶à´¨à´¿'.split("_"),
			weekdaysMin : 'à´žà´¾_à´¤à´¿_à´šàµŠ_à´¬àµ_à´µàµà´¯à´¾_à´µàµ†_à´¶'.split("_"),
			longDateFormat : {
				LT : "A h:mm -à´¨àµ",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY, LT",
				LLLL : "dddd, D MMMM YYYY, LT"
			},
			calendar : {
				sameDay : '[à´‡à´¨àµà´¨àµ] LT',
				nextDay : '[à´¨à´¾à´³àµ†] LT',
				nextWeek : 'dddd, LT',
				lastDay : '[à´‡à´¨àµà´¨à´²àµ†] LT',
				lastWeek : '[à´•à´´à´¿à´žàµà´ž] dddd, LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s à´•à´´à´¿à´žàµà´žàµ",
				past : "%s à´®àµàµ»à´ªàµ",
				s : "à´…àµ½à´ª à´¨à´¿à´®à´¿à´·à´™àµà´™àµ¾",
				m : "à´’à´°àµ à´®à´¿à´¨à´¿à´±àµà´±àµ",
				mm : "%d à´®à´¿à´¨à´¿à´±àµà´±àµ",
				h : "à´’à´°àµ à´®à´£à´¿à´•àµà´•àµ‚àµ¼",
				hh : "%d à´®à´£à´¿à´•àµà´•àµ‚àµ¼",
				d : "à´’à´°àµ à´¦à´¿à´µà´¸à´‚",
				dd : "%d à´¦à´¿à´µà´¸à´‚",
				M : "à´’à´°àµ à´®à´¾à´¸à´‚",
				MM : "%d à´®à´¾à´¸à´‚",
				y : "à´’à´°àµ à´µàµ¼à´·à´‚",
				yy : "%d à´µàµ¼à´·à´‚"
			},
			meridiem : function (hour, minute, isLower) {
				if (hour < 4) {
					return "à´°à´¾à´¤àµà´°à´¿";
				} else if (hour < 12) {
					return "à´°à´¾à´µà´¿à´²àµ†";
				} else if (hour < 17) {
					return "à´‰à´šàµà´š à´•à´´à´¿à´žàµà´žàµ";
				} else if (hour < 20) {
					return "à´µàµˆà´•àµà´¨àµà´¨àµ‡à´°à´‚";
				} else {
					return "à´°à´¾à´¤àµà´°à´¿";
				}
			}
		});
	}));
// moment.js language configuration
// language : Marathi (mr)
// author : Harshad Kale : https://github.com/kalehv

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var symbolMap = {
				'1': 'à¥§',
				'2': 'à¥¨',
				'3': 'à¥©',
				'4': 'à¥ª',
				'5': 'à¥«',
				'6': 'à¥¬',
				'7': 'à¥­',
				'8': 'à¥®',
				'9': 'à¥¯',
				'0': 'à¥¦'
			},
			numberMap = {
				'à¥§': '1',
				'à¥¨': '2',
				'à¥©': '3',
				'à¥ª': '4',
				'à¥«': '5',
				'à¥¬': '6',
				'à¥­': '7',
				'à¥®': '8',
				'à¥¯': '9',
				'à¥¦': '0'
			};

		return moment.lang('mr', {
			months : 'à¤œà¤¾à¤¨à¥‡à¤µà¤¾à¤°à¥€_à¤«à¥‡à¤¬à¥à¤°à¥à¤µà¤¾à¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤à¤ªà¥à¤°à¤¿à¤²_à¤®à¥‡_à¤œà¥‚à¤¨_à¤œà¥à¤²à¥ˆ_à¤‘à¤—à¤¸à¥à¤Ÿ_à¤¸à¤ªà¥à¤Ÿà¥‡à¤‚à¤¬à¤°_à¤‘à¤•à¥à¤Ÿà¥‹à¤¬à¤°_à¤¨à¥‹à¤µà¥à¤¹à¥‡à¤‚à¤¬à¤°_à¤¡à¤¿à¤¸à¥‡à¤‚à¤¬à¤°'.split("_"),
			monthsShort: 'à¤œà¤¾à¤¨à¥‡._à¤«à¥‡à¤¬à¥à¤°à¥._à¤®à¤¾à¤°à¥à¤š._à¤à¤ªà¥à¤°à¤¿._à¤®à¥‡._à¤œà¥‚à¤¨._à¤œà¥à¤²à¥ˆ._à¤‘à¤—._à¤¸à¤ªà¥à¤Ÿà¥‡à¤‚._à¤‘à¤•à¥à¤Ÿà¥‹._à¤¨à¥‹à¤µà¥à¤¹à¥‡à¤‚._à¤¡à¤¿à¤¸à¥‡à¤‚.'.split("_"),
			weekdays : 'à¤°à¤µà¤¿à¤µà¤¾à¤°_à¤¸à¥‹à¤®à¤µà¤¾à¤°_à¤®à¤‚à¤—à¤³à¤µà¤¾à¤°_à¤¬à¥à¤§à¤µà¤¾à¤°_à¤—à¥à¤°à¥‚à¤µà¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤µà¤¾à¤°_à¤¶à¤¨à¤¿à¤µà¤¾à¤°'.split("_"),
			weekdaysShort : 'à¤°à¤µà¤¿_à¤¸à¥‹à¤®_à¤®à¤‚à¤—à¤³_à¤¬à¥à¤§_à¤—à¥à¤°à¥‚_à¤¶à¥à¤•à¥à¤°_à¤¶à¤¨à¤¿'.split("_"),
			weekdaysMin : 'à¤°_à¤¸à¥‹_à¤®à¤‚_à¤¬à¥_à¤—à¥_à¤¶à¥_à¤¶'.split("_"),
			longDateFormat : {
				LT : "A h:mm à¤µà¤¾à¤œà¤¤à¤¾",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY, LT",
				LLLL : "dddd, D MMMM YYYY, LT"
			},
			calendar : {
				sameDay : '[à¤†à¤œ] LT',
				nextDay : '[à¤‰à¤¦à¥à¤¯à¤¾] LT',
				nextWeek : 'dddd, LT',
				lastDay : '[à¤•à¤¾à¤²] LT',
				lastWeek: '[à¤®à¤¾à¤—à¥€à¤²] dddd, LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s à¤¨à¤‚à¤¤à¤°",
				past : "%s à¤ªà¥‚à¤°à¥à¤µà¥€",
				s : "à¤¸à¥‡à¤•à¤‚à¤¦",
				m: "à¤à¤• à¤®à¤¿à¤¨à¤¿à¤Ÿ",
				mm: "%d à¤®à¤¿à¤¨à¤¿à¤Ÿà¥‡",
				h : "à¤à¤• à¤¤à¤¾à¤¸",
				hh : "%d à¤¤à¤¾à¤¸",
				d : "à¤à¤• à¤¦à¤¿à¤µà¤¸",
				dd : "%d à¤¦à¤¿à¤µà¤¸",
				M : "à¤à¤• à¤®à¤¹à¤¿à¤¨à¤¾",
				MM : "%d à¤®à¤¹à¤¿à¤¨à¥‡",
				y : "à¤à¤• à¤µà¤°à¥à¤·",
				yy : "%d à¤µà¤°à¥à¤·à¥‡"
			},
			preparse: function (string) {
				return string.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g, function (match) {
					return numberMap[match];
				});
			},
			postformat: function (string) {
				return string.replace(/\d/g, function (match) {
					return symbolMap[match];
				});
			},
			meridiem: function (hour, minute, isLower)
			{
				if (hour < 4) {
					return "à¤°à¤¾à¤¤à¥à¤°à¥€";
				} else if (hour < 10) {
					return "à¤¸à¤•à¤¾à¤³à¥€";
				} else if (hour < 17) {
					return "à¤¦à¥à¤ªà¤¾à¤°à¥€";
				} else if (hour < 20) {
					return "à¤¸à¤¾à¤¯à¤‚à¤•à¤¾à¤³à¥€";
				} else {
					return "à¤°à¤¾à¤¤à¥à¤°à¥€";
				}
			},
			week : {
				dow : 0, // Sunday is the first day of the week.
				doy : 6  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Bahasa Malaysia (ms-MY)
// author : Weldan Jamili : https://github.com/weldan

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('ms-my', {
			months : "Januari_Februari_Mac_April_Mei_Jun_Julai_Ogos_September_Oktober_November_Disember".split("_"),
			monthsShort : "Jan_Feb_Mac_Apr_Mei_Jun_Jul_Ogs_Sep_Okt_Nov_Dis".split("_"),
			weekdays : "Ahad_Isnin_Selasa_Rabu_Khamis_Jumaat_Sabtu".split("_"),
			weekdaysShort : "Ahd_Isn_Sel_Rab_Kha_Jum_Sab".split("_"),
			weekdaysMin : "Ah_Is_Sl_Rb_Km_Jm_Sb".split("_"),
			longDateFormat : {
				LT : "HH.mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY [pukul] LT",
				LLLL : "dddd, D MMMM YYYY [pukul] LT"
			},
			meridiem : function (hours, minutes, isLower) {
				if (hours < 11) {
					return 'pagi';
				} else if (hours < 15) {
					return 'tengahari';
				} else if (hours < 19) {
					return 'petang';
				} else {
					return 'malam';
				}
			},
			calendar : {
				sameDay : '[Hari ini pukul] LT',
				nextDay : '[Esok pukul] LT',
				nextWeek : 'dddd [pukul] LT',
				lastDay : '[Kelmarin pukul] LT',
				lastWeek : 'dddd [lepas pukul] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "dalam %s",
				past : "%s yang lepas",
				s : "beberapa saat",
				m : "seminit",
				mm : "%d minit",
				h : "sejam",
				hh : "%d jam",
				d : "sehari",
				dd : "%d hari",
				M : "sebulan",
				MM : "%d bulan",
				y : "setahun",
				yy : "%d tahun"
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : norwegian bokmÃ¥l (nb)
// authors : Espen Hovlandsdal : https://github.com/rexxars
//           Sigurd Gartmann : https://github.com/sigurdga

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('nb', {
			months : "januar_februar_mars_april_mai_juni_juli_august_september_oktober_november_desember".split("_"),
			monthsShort : "jan._feb._mars_april_mai_juni_juli_aug._sep._okt._nov._des.".split("_"),
			weekdays : "sÃ¸ndag_mandag_tirsdag_onsdag_torsdag_fredag_lÃ¸rdag".split("_"),
			weekdaysShort : "sÃ¸._ma._ti._on._to._fr._lÃ¸.".split("_"),
			weekdaysMin : "sÃ¸_ma_ti_on_to_fr_lÃ¸".split("_"),
			longDateFormat : {
				LT : "H.mm",
				L : "DD.MM.YYYY",
				LL : "D. MMMM YYYY",
				LLL : "D. MMMM YYYY [kl.] LT",
				LLLL : "dddd D. MMMM YYYY [kl.] LT"
			},
			calendar : {
				sameDay: '[i dag kl.] LT',
				nextDay: '[i morgen kl.] LT',
				nextWeek: 'dddd [kl.] LT',
				lastDay: '[i gÃ¥r kl.] LT',
				lastWeek: '[forrige] dddd [kl.] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "om %s",
				past : "for %s siden",
				s : "noen sekunder",
				m : "ett minutt",
				mm : "%d minutter",
				h : "en time",
				hh : "%d timer",
				d : "en dag",
				dd : "%d dager",
				M : "en mÃ¥ned",
				MM : "%d mÃ¥neder",
				y : "ett Ã¥r",
				yy : "%d Ã¥r"
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : nepali/nepalese
// author : suvash : https://github.com/suvash

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var symbolMap = {
				'1': 'à¥§',
				'2': 'à¥¨',
				'3': 'à¥©',
				'4': 'à¥ª',
				'5': 'à¥«',
				'6': 'à¥¬',
				'7': 'à¥­',
				'8': 'à¥®',
				'9': 'à¥¯',
				'0': 'à¥¦'
			},
			numberMap = {
				'à¥§': '1',
				'à¥¨': '2',
				'à¥©': '3',
				'à¥ª': '4',
				'à¥«': '5',
				'à¥¬': '6',
				'à¥­': '7',
				'à¥®': '8',
				'à¥¯': '9',
				'à¥¦': '0'
			};

		return moment.lang('ne', {
			months : 'à¤œà¤¨à¤µà¤°à¥€_à¤«à¥‡à¤¬à¥à¤°à¥à¤µà¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¤¿à¤²_à¤®à¤ˆ_à¤œà¥à¤¨_à¤œà¥à¤²à¤¾à¤ˆ_à¤…à¤—à¤·à¥à¤Ÿ_à¤¸à¥‡à¤ªà¥à¤Ÿà¥‡à¤®à¥à¤¬à¤°_à¤…à¤•à¥à¤Ÿà¥‹à¤¬à¤°_à¤¨à¥‹à¤­à¥‡à¤®à¥à¤¬à¤°_à¤¡à¤¿à¤¸à¥‡à¤®à¥à¤¬à¤°'.split("_"),
			monthsShort : 'à¤œà¤¨._à¤«à¥‡à¤¬à¥à¤°à¥._à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¤¿._à¤®à¤ˆ_à¤œà¥à¤¨_à¤œà¥à¤²à¤¾à¤ˆ._à¤…à¤—._à¤¸à¥‡à¤ªà¥à¤Ÿ._à¤…à¤•à¥à¤Ÿà¥‹._à¤¨à¥‹à¤­à¥‡._à¤¡à¤¿à¤¸à¥‡.'.split("_"),
			weekdays : 'à¤†à¤‡à¤¤à¤¬à¤¾à¤°_à¤¸à¥‹à¤®à¤¬à¤¾à¤°_à¤®à¤™à¥à¤—à¤²à¤¬à¤¾à¤°_à¤¬à¥à¤§à¤¬à¤¾à¤°_à¤¬à¤¿à¤¹à¤¿à¤¬à¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤¬à¤¾à¤°_à¤¶à¤¨à¤¿à¤¬à¤¾à¤°'.split("_"),
			weekdaysShort : 'à¤†à¤‡à¤¤._à¤¸à¥‹à¤®._à¤®à¤™à¥à¤—à¤²._à¤¬à¥à¤§._à¤¬à¤¿à¤¹à¤¿._à¤¶à¥à¤•à¥à¤°._à¤¶à¤¨à¤¿.'.split("_"),
			weekdaysMin : 'à¤†à¤‡._à¤¸à¥‹._à¤®à¤™à¥_à¤¬à¥._à¤¬à¤¿._à¤¶à¥._à¤¶.'.split("_"),
			longDateFormat : {
				LT : "Aà¤•à¥‹ h:mm à¤¬à¤œà¥‡",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY, LT",
				LLLL : "dddd, D MMMM YYYY, LT"
			},
			preparse: function (string) {
				return string.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g, function (match) {
					return numberMap[match];
				});
			},
			postformat: function (string) {
				return string.replace(/\d/g, function (match) {
					return symbolMap[match];
				});
			},
			meridiem : function (hour, minute, isLower) {
				if (hour < 3) {
					return "à¤°à¤¾à¤¤à¥€";
				} else if (hour < 10) {
					return "à¤¬à¤¿à¤¹à¤¾à¤¨";
				} else if (hour < 15) {
					return "à¤¦à¤¿à¤‰à¤à¤¸à¥‹";
				} else if (hour < 18) {
					return "à¤¬à¥‡à¤²à¥à¤•à¤¾";
				} else if (hour < 20) {
					return "à¤¸à¤¾à¤à¤";
				} else {
					return "à¤°à¤¾à¤¤à¥€";
				}
			},
			calendar : {
				sameDay : '[à¤†à¤œ] LT',
				nextDay : '[à¤­à¥‹à¤²à¥€] LT',
				nextWeek : '[à¤†à¤‰à¤à¤¦à¥‹] dddd[,] LT',
				lastDay : '[à¤¹à¤¿à¤œà¥‹] LT',
				lastWeek : '[à¤—à¤à¤•à¥‹] dddd[,] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%sà¤®à¤¾",
				past : "%s à¤…à¤—à¤¾à¤¡à¥€",
				s : "à¤•à¥‡à¤¹à¥€ à¤¸à¤®à¤¯",
				m : "à¤à¤• à¤®à¤¿à¤¨à¥‡à¤Ÿ",
				mm : "%d à¤®à¤¿à¤¨à¥‡à¤Ÿ",
				h : "à¤à¤• à¤˜à¤£à¥à¤Ÿà¤¾",
				hh : "%d à¤˜à¤£à¥à¤Ÿà¤¾",
				d : "à¤à¤• à¤¦à¤¿à¤¨",
				dd : "%d à¤¦à¤¿à¤¨",
				M : "à¤à¤• à¤®à¤¹à¤¿à¤¨à¤¾",
				MM : "%d à¤®à¤¹à¤¿à¤¨à¤¾",
				y : "à¤à¤• à¤¬à¤°à¥à¤·",
				yy : "%d à¤¬à¤°à¥à¤·"
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : dutch (nl)
// author : Joris RÃ¶ling : https://github.com/jjupiter

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var monthsShortWithDots = "jan._feb._mrt._apr._mei_jun._jul._aug._sep._okt._nov._dec.".split("_"),
			monthsShortWithoutDots = "jan_feb_mrt_apr_mei_jun_jul_aug_sep_okt_nov_dec".split("_");

		return moment.lang('nl', {
			months : "januari_februari_maart_april_mei_juni_juli_augustus_september_oktober_november_december".split("_"),
			monthsShort : function (m, format) {
				if (/-MMM-/.test(format)) {
					return monthsShortWithoutDots[m.month()];
				} else {
					return monthsShortWithDots[m.month()];
				}
			},
			weekdays : "zondag_maandag_dinsdag_woensdag_donderdag_vrijdag_zaterdag".split("_"),
			weekdaysShort : "zo._ma._di._wo._do._vr._za.".split("_"),
			weekdaysMin : "Zo_Ma_Di_Wo_Do_Vr_Za".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD-MM-YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: '[vandaag om] LT',
				nextDay: '[morgen om] LT',
				nextWeek: 'dddd [om] LT',
				lastDay: '[gisteren om] LT',
				lastWeek: '[afgelopen] dddd [om] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "over %s",
				past : "%s geleden",
				s : "een paar seconden",
				m : "Ã©Ã©n minuut",
				mm : "%d minuten",
				h : "Ã©Ã©n uur",
				hh : "%d uur",
				d : "Ã©Ã©n dag",
				dd : "%d dagen",
				M : "Ã©Ã©n maand",
				MM : "%d maanden",
				y : "Ã©Ã©n jaar",
				yy : "%d jaar"
			},
			ordinal : function (number) {
				return number + ((number === 1 || number === 8 || number >= 20) ? 'ste' : 'de');
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : norwegian nynorsk (nn)
// author : https://github.com/mechuwind

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('nn', {
			months : "januar_februar_mars_april_mai_juni_juli_august_september_oktober_november_desember".split("_"),
			monthsShort : "jan_feb_mar_apr_mai_jun_jul_aug_sep_okt_nov_des".split("_"),
			weekdays : "sundag_mÃ¥ndag_tysdag_onsdag_torsdag_fredag_laurdag".split("_"),
			weekdaysShort : "sun_mÃ¥n_tys_ons_tor_fre_lau".split("_"),
			weekdaysMin : "su_mÃ¥_ty_on_to_fr_lÃ¸".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD.MM.YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: '[I dag klokka] LT',
				nextDay: '[I morgon klokka] LT',
				nextWeek: 'dddd [klokka] LT',
				lastDay: '[I gÃ¥r klokka] LT',
				lastWeek: '[FÃ¸regÃ¥ende] dddd [klokka] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "om %s",
				past : "for %s siden",
				s : "noen sekund",
				m : "ett minutt",
				mm : "%d minutt",
				h : "en time",
				hh : "%d timar",
				d : "en dag",
				dd : "%d dagar",
				M : "en mÃ¥nad",
				MM : "%d mÃ¥nader",
				y : "ett Ã¥r",
				yy : "%d Ã¥r"
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : polish (pl)
// author : Rafal Hirsz : https://github.com/evoL

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var monthsNominative = "styczeÅ„_luty_marzec_kwiecieÅ„_maj_czerwiec_lipiec_sierpieÅ„_wrzesieÅ„_paÅºdziernik_listopad_grudzieÅ„".split("_"),
			monthsSubjective = "stycznia_lutego_marca_kwietnia_maja_czerwca_lipca_sierpnia_wrzeÅ›nia_paÅºdziernika_listopada_grudnia".split("_");

		function plural(n) {
			return (n % 10 < 5) && (n % 10 > 1) && (~~(n / 10) !== 1);
		}

		function translate(number, withoutSuffix, key) {
			var result = number + " ";
			switch (key) {
				case 'm':
					return withoutSuffix ? 'minuta' : 'minutÄ™';
				case 'mm':
					return result + (plural(number) ? 'minuty' : 'minut');
				case 'h':
					return withoutSuffix  ? 'godzina'  : 'godzinÄ™';
				case 'hh':
					return result + (plural(number) ? 'godziny' : 'godzin');
				case 'MM':
					return result + (plural(number) ? 'miesiÄ…ce' : 'miesiÄ™cy');
				case 'yy':
					return result + (plural(number) ? 'lata' : 'lat');
			}
		}

		return moment.lang('pl', {
			months : function (momentToFormat, format) {
				if (/D MMMM/.test(format)) {
					return monthsSubjective[momentToFormat.month()];
				} else {
					return monthsNominative[momentToFormat.month()];
				}
			},
			monthsShort : "sty_lut_mar_kwi_maj_cze_lip_sie_wrz_paÅº_lis_gru".split("_"),
			weekdays : "niedziela_poniedziaÅ‚ek_wtorek_Å›roda_czwartek_piÄ…tek_sobota".split("_"),
			weekdaysShort : "nie_pon_wt_Å›r_czw_pt_sb".split("_"),
			weekdaysMin : "N_Pn_Wt_Åšr_Cz_Pt_So".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD.MM.YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendar : {
				sameDay: '[DziÅ› o] LT',
				nextDay: '[Jutro o] LT',
				nextWeek: '[W] dddd [o] LT',
				lastDay: '[Wczoraj o] LT',
				lastWeek: function () {
					switch (this.day()) {
						case 0:
							return '[W zeszÅ‚Ä… niedzielÄ™ o] LT';
						case 3:
							return '[W zeszÅ‚Ä… Å›rodÄ™ o] LT';
						case 6:
							return '[W zeszÅ‚Ä… sobotÄ™ o] LT';
						default:
							return '[W zeszÅ‚y] dddd [o] LT';
					}
				},
				sameElse: 'L'
			},
			relativeTime : {
				future : "za %s",
				past : "%s temu",
				s : "kilka sekund",
				m : translate,
				mm : translate,
				h : translate,
				hh : translate,
				d : "1 dzieÅ„",
				dd : '%d dni',
				M : "miesiÄ…c",
				MM : translate,
				y : "rok",
				yy : translate
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : brazilian portuguese (pt-br)
// author : Caio Ribeiro Pereira : https://github.com/caio-ribeiro-pereira

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('pt-br', {
			months : "Janeiro_Fevereiro_MarÃ§o_Abril_Maio_Junho_Julho_Agosto_Setembro_Outubro_Novembro_Dezembro".split("_"),
			monthsShort : "Jan_Fev_Mar_Abr_Mai_Jun_Jul_Ago_Set_Out_Nov_Dez".split("_"),
			weekdays : "Domingo_Segunda-feira_TerÃ§a-feira_Quarta-feira_Quinta-feira_Sexta-feira_SÃ¡bado".split("_"),
			weekdaysShort : "Dom_Seg_Ter_Qua_Qui_Sex_SÃ¡b".split("_"),
			weekdaysMin : "Dom_2Âª_3Âª_4Âª_5Âª_6Âª_SÃ¡b".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D [de] MMMM [de] YYYY",
				LLL : "D [de] MMMM [de] YYYY LT",
				LLLL : "dddd, D [de] MMMM [de] YYYY LT"
			},
			calendar : {
				sameDay: '[Hoje Ã s] LT',
				nextDay: '[AmanhÃ£ Ã s] LT',
				nextWeek: 'dddd [Ã s] LT',
				lastDay: '[Ontem Ã s] LT',
				lastWeek: function () {
					return (this.day() === 0 || this.day() === 6) ?
						'[Ãšltimo] dddd [Ã s] LT' : // Saturday + Sunday
						'[Ãšltima] dddd [Ã s] LT'; // Monday - Friday
				},
				sameElse: 'L'
			},
			relativeTime : {
				future : "em %s",
				past : "%s atrÃ¡s",
				s : "segundos",
				m : "um minuto",
				mm : "%d minutos",
				h : "uma hora",
				hh : "%d horas",
				d : "um dia",
				dd : "%d dias",
				M : "um mÃªs",
				MM : "%d meses",
				y : "um ano",
				yy : "%d anos"
			},
			ordinal : '%dÂº'
		});
	}));
// moment.js language configuration
// language : portuguese (pt)
// author : Jefferson : https://github.com/jalex79

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('pt', {
			months : "Janeiro_Fevereiro_MarÃ§o_Abril_Maio_Junho_Julho_Agosto_Setembro_Outubro_Novembro_Dezembro".split("_"),
			monthsShort : "Jan_Fev_Mar_Abr_Mai_Jun_Jul_Ago_Set_Out_Nov_Dez".split("_"),
			weekdays : "Domingo_Segunda-feira_TerÃ§a-feira_Quarta-feira_Quinta-feira_Sexta-feira_SÃ¡bado".split("_"),
			weekdaysShort : "Dom_Seg_Ter_Qua_Qui_Sex_SÃ¡b".split("_"),
			weekdaysMin : "Dom_2Âª_3Âª_4Âª_5Âª_6Âª_SÃ¡b".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D [de] MMMM [de] YYYY",
				LLL : "D [de] MMMM [de] YYYY LT",
				LLLL : "dddd, D [de] MMMM [de] YYYY LT"
			},
			calendar : {
				sameDay: '[Hoje Ã s] LT',
				nextDay: '[AmanhÃ£ Ã s] LT',
				nextWeek: 'dddd [Ã s] LT',
				lastDay: '[Ontem Ã s] LT',
				lastWeek: function () {
					return (this.day() === 0 || this.day() === 6) ?
						'[Ãšltimo] dddd [Ã s] LT' : // Saturday + Sunday
						'[Ãšltima] dddd [Ã s] LT'; // Monday - Friday
				},
				sameElse: 'L'
			},
			relativeTime : {
				future : "em %s",
				past : "%s atrÃ¡s",
				s : "segundos",
				m : "um minuto",
				mm : "%d minutos",
				h : "uma hora",
				hh : "%d horas",
				d : "um dia",
				dd : "%d dias",
				M : "um mÃªs",
				MM : "%d meses",
				y : "um ano",
				yy : "%d anos"
			},
			ordinal : '%dÂº',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : romanian (ro)
// author : Vlad Gurdiga : https://github.com/gurdiga
// author : Valentin Agachi : https://github.com/avaly

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('ro', {
			months : "Ianuarie_Februarie_Martie_Aprilie_Mai_Iunie_Iulie_August_Septembrie_Octombrie_Noiembrie_Decembrie".split("_"),
			monthsShort : "Ian_Feb_Mar_Apr_Mai_Iun_Iul_Aug_Sep_Oct_Noi_Dec".split("_"),
			weekdays : "DuminicÄƒ_Luni_MarÅ£i_Miercuri_Joi_Vineri_SÃ¢mbÄƒtÄƒ".split("_"),
			weekdaysShort : "Dum_Lun_Mar_Mie_Joi_Vin_SÃ¢m".split("_"),
			weekdaysMin : "Du_Lu_Ma_Mi_Jo_Vi_SÃ¢".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY H:mm",
				LLLL : "dddd, D MMMM YYYY H:mm"
			},
			calendar : {
				sameDay: "[azi la] LT",
				nextDay: '[mÃ¢ine la] LT',
				nextWeek: 'dddd [la] LT',
				lastDay: '[ieri la] LT',
				lastWeek: '[fosta] dddd [la] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "peste %s",
				past : "%s Ã®n urmÄƒ",
				s : "cÃ¢teva secunde",
				m : "un minut",
				mm : "%d minute",
				h : "o orÄƒ",
				hh : "%d ore",
				d : "o zi",
				dd : "%d zile",
				M : "o lunÄƒ",
				MM : "%d luni",
				y : "un an",
				yy : "%d ani"
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : russian (ru)
// author : Viktorminator : https://github.com/Viktorminator
// Author : Menelion ElensÃºle : https://github.com/Oire

	(function (factory) {
		factory(moment);
	}(function (moment) {
		function plural(word, num) {
			var forms = word.split('_');
			return num % 10 === 1 && num % 100 !== 11 ? forms[0] : (num % 10 >= 2 && num % 10 <= 4 && (num % 100 < 10 || num % 100 >= 20) ? forms[1] : forms[2]);
		}

		function relativeTimeWithPlural(number, withoutSuffix, key) {
			var format = {
				'mm': 'Ð¼Ð¸Ð½ÑƒÑ‚Ð°_Ð¼Ð¸Ð½ÑƒÑ‚Ñ‹_Ð¼Ð¸Ð½ÑƒÑ‚',
				'hh': 'Ñ‡Ð°Ñ_Ñ‡Ð°ÑÐ°_Ñ‡Ð°ÑÐ¾Ð²',
				'dd': 'Ð´ÐµÐ½ÑŒ_Ð´Ð½Ñ_Ð´Ð½ÐµÐ¹',
				'MM': 'Ð¼ÐµÑÑÑ†_Ð¼ÐµÑÑÑ†Ð°_Ð¼ÐµÑÑÑ†ÐµÐ²',
				'yy': 'Ð³Ð¾Ð´_Ð³Ð¾Ð´Ð°_Ð»ÐµÑ‚'
			};
			if (key === 'm') {
				return withoutSuffix ? 'Ð¼Ð¸Ð½ÑƒÑ‚Ð°' : 'Ð¼Ð¸Ð½ÑƒÑ‚Ñƒ';
			}
			else {
				return number + ' ' + plural(format[key], +number);
			}
		}

		function monthsCaseReplace(m, format) {
			var months = {
					'nominative': 'ÑÐ½Ð²Ð°Ñ€ÑŒ_Ñ„ÐµÐ²Ñ€Ð°Ð»ÑŒ_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€ÐµÐ»ÑŒ_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ½Ñ‚ÑÐ±Ñ€ÑŒ_Ð¾ÐºÑ‚ÑÐ±Ñ€ÑŒ_Ð½Ð¾ÑÐ±Ñ€ÑŒ_Ð´ÐµÐºÐ°Ð±Ñ€ÑŒ'.split('_'),
					'accusative': 'ÑÐ½Ð²Ð°Ñ€Ñ_Ñ„ÐµÐ²Ñ€Ð°Ð»Ñ_Ð¼Ð°Ñ€Ñ‚Ð°_Ð°Ð¿Ñ€ÐµÐ»Ñ_Ð¼Ð°Ñ_Ð¸ÑŽÐ½Ñ_Ð¸ÑŽÐ»Ñ_Ð°Ð²Ð³ÑƒÑÑ‚Ð°_ÑÐµÐ½Ñ‚ÑÐ±Ñ€Ñ_Ð¾ÐºÑ‚ÑÐ±Ñ€Ñ_Ð½Ð¾ÑÐ±Ñ€Ñ_Ð´ÐµÐºÐ°Ð±Ñ€Ñ'.split('_')
				},

				nounCase = (/D[oD]?(\[[^\[\]]*\]|\s+)+MMMM?/).test(format) ?
					'accusative' :
					'nominative';

			return months[nounCase][m.month()];
		}

		function monthsShortCaseReplace(m, format) {
			var monthsShort = {
					'nominative': 'ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº'.split('_'),
					'accusative': 'ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ñ_Ð¸ÑŽÐ½Ñ_Ð¸ÑŽÐ»Ñ_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº'.split('_')
				},

				nounCase = (/D[oD]?(\[[^\[\]]*\]|\s+)+MMMM?/).test(format) ?
					'accusative' :
					'nominative';

			return monthsShort[nounCase][m.month()];
		}

		function weekdaysCaseReplace(m, format) {
			var weekdays = {
					'nominative': 'Ð²Ð¾ÑÐºÑ€ÐµÑÐµÐ½ÑŒÐµ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»ÑŒÐ½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÐµÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³_Ð¿ÑÑ‚Ð½Ð¸Ñ†Ð°_ÑÑƒÐ±Ð±Ð¾Ñ‚Ð°'.split('_'),
					'accusative': 'Ð²Ð¾ÑÐºÑ€ÐµÑÐµÐ½ÑŒÐµ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»ÑŒÐ½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÐµÐ´Ñƒ_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³_Ð¿ÑÑ‚Ð½Ð¸Ñ†Ñƒ_ÑÑƒÐ±Ð±Ð¾Ñ‚Ñƒ'.split('_')
				},

				nounCase = (/\[ ?[Ð’Ð²] ?(?:Ð¿Ñ€Ð¾ÑˆÐ»ÑƒÑŽ|ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÑƒÑŽ)? ?\] ?dddd/).test(format) ?
					'accusative' :
					'nominative';

			return weekdays[nounCase][m.day()];
		}

		return moment.lang('ru', {
			months : monthsCaseReplace,
			monthsShort : monthsShortCaseReplace,
			weekdays : weekdaysCaseReplace,
			weekdaysShort : "Ð²Ñ_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
			weekdaysMin : "Ð²Ñ_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
			monthsParse : [/^ÑÐ½Ð²/i, /^Ñ„ÐµÐ²/i, /^Ð¼Ð°Ñ€/i, /^Ð°Ð¿Ñ€/i, /^Ð¼Ð°[Ð¹|Ñ]/i, /^Ð¸ÑŽÐ½/i, /^Ð¸ÑŽÐ»/i, /^Ð°Ð²Ð³/i, /^ÑÐµÐ½/i, /^Ð¾ÐºÑ‚/i, /^Ð½Ð¾Ñ/i, /^Ð´ÐµÐº/i],
			longDateFormat : {
				LT : "HH:mm",
				L : "DD.MM.YYYY",
				LL : "D MMMM YYYY Ð³.",
				LLL : "D MMMM YYYY Ð³., LT",
				LLLL : "dddd, D MMMM YYYY Ð³., LT"
			},
			calendar : {
				sameDay: '[Ð¡ÐµÐ³Ð¾Ð´Ð½Ñ Ð²] LT',
				nextDay: '[Ð—Ð°Ð²Ñ‚Ñ€Ð° Ð²] LT',
				lastDay: '[Ð’Ñ‡ÐµÑ€Ð° Ð²] LT',
				nextWeek: function () {
					return this.day() === 2 ? '[Ð’Ð¾] dddd [Ð²] LT' : '[Ð’] dddd [Ð²] LT';
				},
				lastWeek: function () {
					switch (this.day()) {
						case 0:
							return '[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»Ð¾Ðµ] dddd [Ð²] LT';
						case 1:
						case 2:
						case 4:
							return '[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»Ñ‹Ð¹] dddd [Ð²] LT';
						case 3:
						case 5:
						case 6:
							return '[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»ÑƒÑŽ] dddd [Ð²] LT';
					}
				},
				sameElse: 'L'
			},
			relativeTime : {
				future : "Ñ‡ÐµÑ€ÐµÐ· %s",
				past : "%s Ð½Ð°Ð·Ð°Ð´",
				s : "Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¾ ÑÐµÐºÑƒÐ½Ð´",
				m : relativeTimeWithPlural,
				mm : relativeTimeWithPlural,
				h : "Ñ‡Ð°Ñ",
				hh : relativeTimeWithPlural,
				d : "Ð´ÐµÐ½ÑŒ",
				dd : relativeTimeWithPlural,
				M : "Ð¼ÐµÑÑÑ†",
				MM : relativeTimeWithPlural,
				y : "Ð³Ð¾Ð´",
				yy : relativeTimeWithPlural
			},

			// M. E.: those two are virtually unused but a user might want to implement them for his/her website for some reason

			meridiem : function (hour, minute, isLower) {
				if (hour < 4) {
					return "Ð½Ð¾Ñ‡Ð¸";
				} else if (hour < 12) {
					return "ÑƒÑ‚Ñ€Ð°";
				} else if (hour < 17) {
					return "Ð´Ð½Ñ";
				} else {
					return "Ð²ÐµÑ‡ÐµÑ€Ð°";
				}
			},

			ordinal: function (number, period) {
				switch (period) {
					case 'M':
					case 'd':
					case 'DDD':
						return number + '-Ð¹';
					case 'D':
						return number + '-Ð³Ð¾';
					case 'w':
					case 'W':
						return number + '-Ñ';
					default:
						return number;
				}
			},

			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : slovak (sk)
// author : Martin Minka : https://github.com/k2s
// based on work of petrbela : https://github.com/petrbela

	(function (factory) {
		factory(moment);
	}(function (moment) {
		var months = "januÃ¡r_februÃ¡r_marec_aprÃ­l_mÃ¡j_jÃºn_jÃºl_august_september_oktÃ³ber_november_december".split("_"),
			monthsShort = "jan_feb_mar_apr_mÃ¡j_jÃºn_jÃºl_aug_sep_okt_nov_dec".split("_");

		function plural(n) {
			return (n > 1) && (n < 5);
		}

		function translate(number, withoutSuffix, key, isFuture) {
			var result = number + " ";
			switch (key) {
				case 's':  // a few seconds / in a few seconds / a few seconds ago
					return (withoutSuffix || isFuture) ? 'pÃ¡r sekÃºnd' : 'pÃ¡r sekundami';
				case 'm':  // a minute / in a minute / a minute ago
					return withoutSuffix ? 'minÃºta' : (isFuture ? 'minÃºtu' : 'minÃºtou');
				case 'mm': // 9 minutes / in 9 minutes / 9 minutes ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'minÃºty' : 'minÃºt');
					} else {
						return result + 'minÃºtami';
					}
					break;
				case 'h':  // an hour / in an hour / an hour ago
					return withoutSuffix ? 'hodina' : (isFuture ? 'hodinu' : 'hodinou');
				case 'hh': // 9 hours / in 9 hours / 9 hours ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'hodiny' : 'hodÃ­n');
					} else {
						return result + 'hodinami';
					}
					break;
				case 'd':  // a day / in a day / a day ago
					return (withoutSuffix || isFuture) ? 'deÅˆ' : 'dÅˆom';
				case 'dd': // 9 days / in 9 days / 9 days ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'dni' : 'dnÃ­');
					} else {
						return result + 'dÅˆami';
					}
					break;
				case 'M':  // a month / in a month / a month ago
					return (withoutSuffix || isFuture) ? 'mesiac' : 'mesiacom';
				case 'MM': // 9 months / in 9 months / 9 months ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'mesiace' : 'mesiacov');
					} else {
						return result + 'mesiacmi';
					}
					break;
				case 'y':  // a year / in a year / a year ago
					return (withoutSuffix || isFuture) ? 'rok' : 'rokom';
				case 'yy': // 9 years / in 9 years / 9 years ago
					if (withoutSuffix || isFuture) {
						return result + (plural(number) ? 'roky' : 'rokov');
					} else {
						return result + 'rokmi';
					}
					break;
			}
		}

		return moment.lang('sk', {
			months : months,
			monthsShort : monthsShort,
			monthsParse : (function (months, monthsShort) {
				var i, _monthsParse = [];
				for (i = 0; i < 12; i++) {
					// use custom parser to solve problem with July (Äervenec)
					_monthsParse[i] = new RegExp('^' + months[i] + '$|^' + monthsShort[i] + '$', 'i');
				}
				return _monthsParse;
			}(months, monthsShort)),
			weekdays : "nedeÄ¾a_pondelok_utorok_streda_Å¡tvrtok_piatok_sobota".split("_"),
			weekdaysShort : "ne_po_ut_st_Å¡t_pi_so".split("_"),
			weekdaysMin : "ne_po_ut_st_Å¡t_pi_so".split("_"),
			longDateFormat : {
				LT: "H:mm",
				L : "DD.MM.YYYY",
				LL : "D. MMMM YYYY",
				LLL : "D. MMMM YYYY LT",
				LLLL : "dddd D. MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[dnes o] LT",
				nextDay: '[zajtra o] LT',
				nextWeek: function () {
					switch (this.day()) {
						case 0:
							return '[v nedeÄ¾u o] LT';
						case 1:
						case 2:
							return '[v] dddd [o] LT';
						case 3:
							return '[v stredu o] LT';
						case 4:
							return '[vo Å¡tvrtok o] LT';
						case 5:
							return '[v piatok o] LT';
						case 6:
							return '[v sobotu o] LT';
					}
				},
				lastDay: '[vÄera o] LT',
				lastWeek: function () {
					switch (this.day()) {
						case 0:
							return '[minulÃº nedeÄ¾u o] LT';
						case 1:
						case 2:
							return '[minulÃ½] dddd [o] LT';
						case 3:
							return '[minulÃº stredu o] LT';
						case 4:
						case 5:
							return '[minulÃ½] dddd [o] LT';
						case 6:
							return '[minulÃº sobotu o] LT';
					}
				},
				sameElse: "L"
			},
			relativeTime : {
				future : "za %s",
				past : "pred %s",
				s : translate,
				m : translate,
				mm : translate,
				h : translate,
				hh : translate,
				d : translate,
				dd : translate,
				M : translate,
				MM : translate,
				y : translate,
				yy : translate
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : slovenian (sl)
// author : Robert SedovÅ¡ek : https://github.com/sedovsek

	(function (factory) {
		factory(moment);
	}(function (moment) {
		function translate(number, withoutSuffix, key) {
			var result = number + " ";
			switch (key) {
				case 'm':
					return withoutSuffix ? 'ena minuta' : 'eno minuto';
				case 'mm':
					if (number === 1) {
						result += 'minuta';
					} else if (number === 2) {
						result += 'minuti';
					} else if (number === 3 || number === 4) {
						result += 'minute';
					} else {
						result += 'minut';
					}
					return result;
				case 'h':
					return withoutSuffix ? 'ena ura' : 'eno uro';
				case 'hh':
					if (number === 1) {
						result += 'ura';
					} else if (number === 2) {
						result += 'uri';
					} else if (number === 3 || number === 4) {
						result += 'ure';
					} else {
						result += 'ur';
					}
					return result;
				case 'dd':
					if (number === 1) {
						result += 'dan';
					} else {
						result += 'dni';
					}
					return result;
				case 'MM':
					if (number === 1) {
						result += 'mesec';
					} else if (number === 2) {
						result += 'meseca';
					} else if (number === 3 || number === 4) {
						result += 'mesece';
					} else {
						result += 'mesecev';
					}
					return result;
				case 'yy':
					if (number === 1) {
						result += 'leto';
					} else if (number === 2) {
						result += 'leti';
					} else if (number === 3 || number === 4) {
						result += 'leta';
					} else {
						result += 'let';
					}
					return result;
			}
		}

		return moment.lang('sl', {
			months : "januar_februar_marec_april_maj_junij_julij_avgust_september_oktober_november_december".split("_"),
			monthsShort : "jan._feb._mar._apr._maj._jun._jul._avg._sep._okt._nov._dec.".split("_"),
			weekdays : "nedelja_ponedeljek_torek_sreda_Äetrtek_petek_sobota".split("_"),
			weekdaysShort : "ned._pon._tor._sre._Äet._pet._sob.".split("_"),
			weekdaysMin : "ne_po_to_sr_Äe_pe_so".split("_"),
			longDateFormat : {
				LT : "H:mm",
				L : "DD. MM. YYYY",
				LL : "D. MMMM YYYY",
				LLL : "D. MMMM YYYY LT",
				LLLL : "dddd, D. MMMM YYYY LT"
			},
			calendar : {
				sameDay  : '[danes ob] LT',
				nextDay  : '[jutri ob] LT',

				nextWeek : function () {
					switch (this.day()) {
						case 0:
							return '[v] [nedeljo] [ob] LT';
						case 3:
							return '[v] [sredo] [ob] LT';
						case 6:
							return '[v] [soboto] [ob] LT';
						case 1:
						case 2:
						case 4:
						case 5:
							return '[v] dddd [ob] LT';
					}
				},
				lastDay  : '[vÄeraj ob] LT',
				lastWeek : function () {
					switch (this.day()) {
						case 0:
						case 3:
						case 6:
							return '[prejÅ¡nja] dddd [ob] LT';
						case 1:
						case 2:
						case 4:
						case 5:
							return '[prejÅ¡nji] dddd [ob] LT';
					}
				},
				sameElse : 'L'
			},
			relativeTime : {
				future : "Äez %s",
				past   : "%s nazaj",
				s      : "nekaj sekund",
				m      : translate,
				mm     : translate,
				h      : translate,
				hh     : translate,
				d      : "en dan",
				dd     : translate,
				M      : "en mesec",
				MM     : translate,
				y      : "eno leto",
				yy     : translate
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Albanian (sq)
// author : FlakÃ«rim Ismani : https://github.com/flakerimi
// author: Menelion ElensÃºle: https://github.com/Oire (tests)

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('sq', {
			months : "Janar_Shkurt_Mars_Prill_Maj_Qershor_Korrik_Gusht_Shtator_Tetor_NÃ«ntor_Dhjetor".split("_"),
			monthsShort : "Jan_Shk_Mar_Pri_Maj_Qer_Kor_Gus_Sht_Tet_NÃ«n_Dhj".split("_"),
			weekdays : "E Diel_E HÃ«nÃ«_E Marte_E MÃ«rkure_E Enjte_E Premte_E ShtunÃ«".split("_"),
			weekdaysShort : "Die_HÃ«n_Mar_MÃ«r_Enj_Pre_Sht".split("_"),
			weekdaysMin : "D_H_Ma_MÃ«_E_P_Sh".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendar : {
				sameDay : '[Sot nÃ«] LT',
				nextDay : '[Neser nÃ«] LT',
				nextWeek : 'dddd [nÃ«] LT',
				lastDay : '[Dje nÃ«] LT',
				lastWeek : 'dddd [e kaluar nÃ«] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "nÃ« %s",
				past : "%s me parÃ«",
				s : "disa seconda",
				m : "njÃ« minut",
				mm : "%d minutea",
				h : "njÃ« orÃ«",
				hh : "%d orÃ«",
				d : "njÃ« ditÃ«",
				dd : "%d ditÃ«",
				M : "njÃ« muaj",
				MM : "%d muaj",
				y : "njÃ« vit",
				yy : "%d vite"
			},
			ordinal : '%d.',
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : swedish (sv)
// author : Jens Alm : https://github.com/ulmus

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('sv', {
			months : "januari_februari_mars_april_maj_juni_juli_augusti_september_oktober_november_december".split("_"),
			monthsShort : "jan_feb_mar_apr_maj_jun_jul_aug_sep_okt_nov_dec".split("_"),
			weekdays : "sÃ¶ndag_mÃ¥ndag_tisdag_onsdag_torsdag_fredag_lÃ¶rdag".split("_"),
			weekdaysShort : "sÃ¶n_mÃ¥n_tis_ons_tor_fre_lÃ¶r".split("_"),
			weekdaysMin : "sÃ¶_mÃ¥_ti_on_to_fr_lÃ¶".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "YYYY-MM-DD",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: '[Idag] LT',
				nextDay: '[Imorgon] LT',
				lastDay: '[IgÃ¥r] LT',
				nextWeek: 'dddd LT',
				lastWeek: '[FÃ¶rra] dddd[en] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "om %s",
				past : "fÃ¶r %s sedan",
				s : "nÃ¥gra sekunder",
				m : "en minut",
				mm : "%d minuter",
				h : "en timme",
				hh : "%d timmar",
				d : "en dag",
				dd : "%d dagar",
				M : "en mÃ¥nad",
				MM : "%d mÃ¥nader",
				y : "ett Ã¥r",
				yy : "%d Ã¥r"
			},
			ordinal : function (number) {
				var b = number % 10,
					output = (~~ (number % 100 / 10) === 1) ? 'e' :
						(b === 1) ? 'a' :
							(b === 2) ? 'a' :
								(b === 3) ? 'e' : 'e';
				return number + output;
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : thai (th)
// author : Kridsada Thanabulpong : https://github.com/sirn

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('th', {
			months : "à¸¡à¸à¸£à¸²à¸„à¸¡_à¸à¸¸à¸¡à¸ à¸²à¸žà¸±à¸™à¸˜à¹Œ_à¸¡à¸µà¸™à¸²à¸„à¸¡_à¹€à¸¡à¸©à¸²à¸¢à¸™_à¸žà¸¤à¸©à¸ à¸²à¸„à¸¡_à¸¡à¸´à¸–à¸¸à¸™à¸²à¸¢à¸™_à¸à¸£à¸à¸Žà¸²à¸„à¸¡_à¸ªà¸´à¸‡à¸«à¸²à¸„à¸¡_à¸à¸±à¸™à¸¢à¸²à¸¢à¸™_à¸•à¸¸à¸¥à¸²à¸„à¸¡_à¸žà¸¤à¸¨à¸ˆà¸´à¸à¸²à¸¢à¸™_à¸˜à¸±à¸™à¸§à¸²à¸„à¸¡".split("_"),
			monthsShort : "à¸¡à¸à¸£à¸²_à¸à¸¸à¸¡à¸ à¸²_à¸¡à¸µà¸™à¸²_à¹€à¸¡à¸©à¸²_à¸žà¸¤à¸©à¸ à¸²_à¸¡à¸´à¸–à¸¸à¸™à¸²_à¸à¸£à¸à¸Žà¸²_à¸ªà¸´à¸‡à¸«à¸²_à¸à¸±à¸™à¸¢à¸²_à¸•à¸¸à¸¥à¸²_à¸žà¸¤à¸¨à¸ˆà¸´à¸à¸²_à¸˜à¸±à¸™à¸§à¸²".split("_"),
			weekdays : "à¸­à¸²à¸—à¸´à¸•à¸¢à¹Œ_à¸ˆà¸±à¸™à¸—à¸£à¹Œ_à¸­à¸±à¸‡à¸„à¸²à¸£_à¸žà¸¸à¸˜_à¸žà¸¤à¸«à¸±à¸ªà¸šà¸”à¸µ_à¸¨à¸¸à¸à¸£à¹Œ_à¹€à¸ªà¸²à¸£à¹Œ".split("_"),
			weekdaysShort : "à¸­à¸²à¸—à¸´à¸•à¸¢à¹Œ_à¸ˆà¸±à¸™à¸—à¸£à¹Œ_à¸­à¸±à¸‡à¸„à¸²à¸£_à¸žà¸¸à¸˜_à¸žà¸¤à¸«à¸±à¸ª_à¸¨à¸¸à¸à¸£à¹Œ_à¹€à¸ªà¸²à¸£à¹Œ".split("_"), // yes, three characters difference
			weekdaysMin : "à¸­à¸²._à¸ˆ._à¸­._à¸ž._à¸žà¸¤._à¸¨._à¸ª.".split("_"),
			longDateFormat : {
				LT : "H à¸™à¸²à¸¬à¸´à¸à¸² m à¸™à¸²à¸—à¸µ",
				L : "YYYY/MM/DD",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY à¹€à¸§à¸¥à¸² LT",
				LLLL : "à¸§à¸±à¸™ddddà¸—à¸µà¹ˆ D MMMM YYYY à¹€à¸§à¸¥à¸² LT"
			},
			meridiem : function (hour, minute, isLower) {
				if (hour < 12) {
					return "à¸à¹ˆà¸­à¸™à¹€à¸—à¸µà¹ˆà¸¢à¸‡";
				} else {
					return "à¸«à¸¥à¸±à¸‡à¹€à¸—à¸µà¹ˆà¸¢à¸‡";
				}
			},
			calendar : {
				sameDay : '[à¸§à¸±à¸™à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT',
				nextDay : '[à¸žà¸£à¸¸à¹ˆà¸‡à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT',
				nextWeek : 'dddd[à¸«à¸™à¹‰à¸² à¹€à¸§à¸¥à¸²] LT',
				lastDay : '[à¹€à¸¡à¸·à¹ˆà¸­à¸§à¸²à¸™à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT',
				lastWeek : '[à¸§à¸±à¸™]dddd[à¸—à¸µà¹ˆà¹à¸¥à¹‰à¸§ à¹€à¸§à¸¥à¸²] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "à¸­à¸µà¸ %s",
				past : "%sà¸—à¸µà¹ˆà¹à¸¥à¹‰à¸§",
				s : "à¹„à¸¡à¹ˆà¸à¸µà¹ˆà¸§à¸´à¸™à¸²à¸—à¸µ",
				m : "1 à¸™à¸²à¸—à¸µ",
				mm : "%d à¸™à¸²à¸—à¸µ",
				h : "1 à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡",
				hh : "%d à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡",
				d : "1 à¸§à¸±à¸™",
				dd : "%d à¸§à¸±à¸™",
				M : "1 à¹€à¸”à¸·à¸­à¸™",
				MM : "%d à¹€à¸”à¸·à¸­à¸™",
				y : "1 à¸›à¸µ",
				yy : "%d à¸›à¸µ"
			}
		});
	}));
// moment.js language configuration
// language : Tagalog/Filipino (tl-ph)
// author : Dan Hagman

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('tl-ph', {
			months : "Enero_Pebrero_Marso_Abril_Mayo_Hunyo_Hulyo_Agosto_Setyembre_Oktubre_Nobyembre_Disyembre".split("_"),
			monthsShort : "Ene_Peb_Mar_Abr_May_Hun_Hul_Ago_Set_Okt_Nob_Dis".split("_"),
			weekdays : "Linggo_Lunes_Martes_Miyerkules_Huwebes_Biyernes_Sabado".split("_"),
			weekdaysShort : "Lin_Lun_Mar_Miy_Huw_Biy_Sab".split("_"),
			weekdaysMin : "Li_Lu_Ma_Mi_Hu_Bi_Sab".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "MM/D/YYYY",
				LL : "MMMM D, YYYY",
				LLL : "MMMM D, YYYY LT",
				LLLL : "dddd, MMMM DD, YYYY LT"
			},
			calendar : {
				sameDay: "[Ngayon sa] LT",
				nextDay: '[Bukas sa] LT',
				nextWeek: 'dddd [sa] LT',
				lastDay: '[Kahapon sa] LT',
				lastWeek: 'dddd [huling linggo] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "sa loob ng %s",
				past : "%s ang nakalipas",
				s : "ilang segundo",
				m : "isang minuto",
				mm : "%d minuto",
				h : "isang oras",
				hh : "%d oras",
				d : "isang araw",
				dd : "%d araw",
				M : "isang buwan",
				MM : "%d buwan",
				y : "isang taon",
				yy : "%d taon"
			},
			ordinal : function (number) {
				return number;
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : turkish (tr)
// authors : Erhan Gundogan : https://github.com/erhangundogan,
//           Burak YiÄŸit Kaya: https://github.com/BYK

	(function (factory) {
		factory(moment);
	}(function (moment) {

		var suffixes = {
			1: "'inci",
			5: "'inci",
			8: "'inci",
			70: "'inci",
			80: "'inci",

			2: "'nci",
			7: "'nci",
			20: "'nci",
			50: "'nci",

			3: "'Ã¼ncÃ¼",
			4: "'Ã¼ncÃ¼",
			100: "'Ã¼ncÃ¼",

			6: "'ncÄ±",

			9: "'uncu",
			10: "'uncu",
			30: "'uncu",

			60: "'Ä±ncÄ±",
			90: "'Ä±ncÄ±"
		};

		return moment.lang('tr', {
			months : "Ocak_Åžubat_Mart_Nisan_MayÄ±s_Haziran_Temmuz_AÄŸustos_EylÃ¼l_Ekim_KasÄ±m_AralÄ±k".split("_"),
			monthsShort : "Oca_Åžub_Mar_Nis_May_Haz_Tem_AÄŸu_Eyl_Eki_Kas_Ara".split("_"),
			weekdays : "Pazar_Pazartesi_SalÄ±_Ã‡arÅŸamba_PerÅŸembe_Cuma_Cumartesi".split("_"),
			weekdaysShort : "Paz_Pts_Sal_Ã‡ar_Per_Cum_Cts".split("_"),
			weekdaysMin : "Pz_Pt_Sa_Ã‡a_Pe_Cu_Ct".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD.MM.YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd, D MMMM YYYY LT"
			},
			calendar : {
				sameDay : '[bugÃ¼n saat] LT',
				nextDay : '[yarÄ±n saat] LT',
				nextWeek : '[haftaya] dddd [saat] LT',
				lastDay : '[dÃ¼n] LT',
				lastWeek : '[geÃ§en hafta] dddd [saat] LT',
				sameElse : 'L'
			},
			relativeTime : {
				future : "%s sonra",
				past : "%s Ã¶nce",
				s : "birkaÃ§ saniye",
				m : "bir dakika",
				mm : "%d dakika",
				h : "bir saat",
				hh : "%d saat",
				d : "bir gÃ¼n",
				dd : "%d gÃ¼n",
				M : "bir ay",
				MM : "%d ay",
				y : "bir yÄ±l",
				yy : "%d yÄ±l"
			},
			ordinal : function (number) {
				if (number === 0) {  // special case for zero
					return number + "'Ä±ncÄ±";
				}
				var a = number % 10,
					b = number % 100 - a,
					c = number >= 100 ? 100 : null;

				return number + (suffixes[a] || suffixes[b] || suffixes[c]);
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Morocco Central Atlas TamaziÉ£t in Latin (tzm-la)
// author : Abdel Said : https://github.com/abdelsaid

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('tzm-la', {
			months : "innayr_brË¤ayrË¤_marË¤sË¤_ibrir_mayyw_ywnyw_ywlywz_É£wÅ¡t_Å¡wtanbir_ktË¤wbrË¤_nwwanbir_dwjnbir".split("_"),
			monthsShort : "innayr_brË¤ayrË¤_marË¤sË¤_ibrir_mayyw_ywnyw_ywlywz_É£wÅ¡t_Å¡wtanbir_ktË¤wbrË¤_nwwanbir_dwjnbir".split("_"),
			weekdays : "asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),
			weekdaysShort : "asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),
			weekdaysMin : "asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[asdkh g] LT",
				nextDay: '[aska g] LT',
				nextWeek: 'dddd [g] LT',
				lastDay: '[assant g] LT',
				lastWeek: 'dddd [g] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "dadkh s yan %s",
				past : "yan %s",
				s : "imik",
				m : "minuá¸",
				mm : "%d minuá¸",
				h : "saÉ›a",
				hh : "%d tassaÉ›in",
				d : "ass",
				dd : "%d ossan",
				M : "ayowr",
				MM : "%d iyyirn",
				y : "asgas",
				yy : "%d isgasn"
			},
			week : {
				dow : 6, // Saturday is the first day of the week.
				doy : 12  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : Morocco Central Atlas TamaziÉ£t (tzm)
// author : Abdel Said : https://github.com/abdelsaid

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('tzm', {
			months : "âµ‰âµâµâ´°âµ¢âµ”_â´±âµ•â´°âµ¢âµ•_âµŽâ´°âµ•âµš_âµ‰â´±âµ”âµ‰âµ”_âµŽâ´°âµ¢âµ¢âµ“_âµ¢âµ“âµâµ¢âµ“_âµ¢âµ“âµâµ¢âµ“âµ£_âµ–âµ“âµ›âµœ_âµ›âµ“âµœâ´°âµâ´±âµ‰âµ”_â´½âµŸâµ“â´±âµ•_âµâµ“âµ¡â´°âµâ´±âµ‰âµ”_â´·âµ“âµŠâµâ´±âµ‰âµ”".split("_"),
			monthsShort : "âµ‰âµâµâ´°âµ¢âµ”_â´±âµ•â´°âµ¢âµ•_âµŽâ´°âµ•âµš_âµ‰â´±âµ”âµ‰âµ”_âµŽâ´°âµ¢âµ¢âµ“_âµ¢âµ“âµâµ¢âµ“_âµ¢âµ“âµâµ¢âµ“âµ£_âµ–âµ“âµ›âµœ_âµ›âµ“âµœâ´°âµâ´±âµ‰âµ”_â´½âµŸâµ“â´±âµ•_âµâµ“âµ¡â´°âµâ´±âµ‰âµ”_â´·âµ“âµŠâµâ´±âµ‰âµ”".split("_"),
			weekdays : "â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),
			weekdaysShort : "â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),
			weekdaysMin : "â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "dddd D MMMM YYYY LT"
			},
			calendar : {
				sameDay: "[â´°âµ™â´·âµ… â´´] LT",
				nextDay: '[â´°âµ™â´½â´° â´´] LT',
				nextWeek: 'dddd [â´´] LT',
				lastDay: '[â´°âµšâ´°âµâµœ â´´] LT',
				lastWeek: 'dddd [â´´] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "â´·â´°â´·âµ… âµ™ âµ¢â´°âµ %s",
				past : "âµ¢â´°âµ %s",
				s : "âµ‰âµŽâµ‰â´½",
				m : "âµŽâµ‰âµâµ“â´º",
				mm : "%d âµŽâµ‰âµâµ“â´º",
				h : "âµ™â´°âµ„â´°",
				hh : "%d âµœâ´°âµ™âµ™â´°âµ„âµ‰âµ",
				d : "â´°âµ™âµ™",
				dd : "%d oâµ™âµ™â´°âµ",
				M : "â´°âµ¢oâµ“âµ”",
				MM : "%d âµ‰âµ¢âµ¢âµ‰âµ”âµ",
				y : "â´°âµ™â´³â´°âµ™",
				yy : "%d âµ‰âµ™â´³â´°âµ™âµ"
			},
			week : {
				dow : 6, // Saturday is the first day of the week.
				doy : 12  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : ukrainian (uk)
// author : zemlanin : https://github.com/zemlanin
// Author : Menelion ElensÃºle : https://github.com/Oire

	(function (factory) {
		factory(moment);
	}(function (moment) {
		function plural(word, num) {
			var forms = word.split('_');
			return num % 10 === 1 && num % 100 !== 11 ? forms[0] : (num % 10 >= 2 && num % 10 <= 4 && (num % 100 < 10 || num % 100 >= 20) ? forms[1] : forms[2]);
		}

		function relativeTimeWithPlural(number, withoutSuffix, key) {
			var format = {
				'mm': 'Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð°_Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð¸_Ñ…Ð²Ð¸Ð»Ð¸Ð½',
				'hh': 'Ð³Ð¾Ð´Ð¸Ð½Ð°_Ð³Ð¾Ð´Ð¸Ð½Ð¸_Ð³Ð¾Ð´Ð¸Ð½',
				'dd': 'Ð´ÐµÐ½ÑŒ_Ð´Ð½Ñ–_Ð´Ð½Ñ–Ð²',
				'MM': 'Ð¼Ñ–ÑÑÑ†ÑŒ_Ð¼Ñ–ÑÑÑ†Ñ–_Ð¼Ñ–ÑÑÑ†Ñ–Ð²',
				'yy': 'Ñ€Ñ–Ðº_Ñ€Ð¾ÐºÐ¸_Ñ€Ð¾ÐºÑ–Ð²'
			};
			if (key === 'm') {
				return withoutSuffix ? 'Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð°' : 'Ñ…Ð²Ð¸Ð»Ð¸Ð½Ñƒ';
			}
			else if (key === 'h') {
				return withoutSuffix ? 'Ð³Ð¾Ð´Ð¸Ð½Ð°' : 'Ð³Ð¾Ð´Ð¸Ð½Ñƒ';
			}
			else {
				return number + ' ' + plural(format[key], +number);
			}
		}

		function monthsCaseReplace(m, format) {
			var months = {
					'nominative': 'ÑÑ–Ñ‡ÐµÐ½ÑŒ_Ð»ÑŽÑ‚Ð¸Ð¹_Ð±ÐµÑ€ÐµÐ·ÐµÐ½ÑŒ_ÐºÐ²Ñ–Ñ‚ÐµÐ½ÑŒ_Ñ‚Ñ€Ð°Ð²ÐµÐ½ÑŒ_Ñ‡ÐµÑ€Ð²ÐµÐ½ÑŒ_Ð»Ð¸Ð¿ÐµÐ½ÑŒ_ÑÐµÑ€Ð¿ÐµÐ½ÑŒ_Ð²ÐµÑ€ÐµÑÐµÐ½ÑŒ_Ð¶Ð¾Ð²Ñ‚ÐµÐ½ÑŒ_Ð»Ð¸ÑÑ‚Ð¾Ð¿Ð°Ð´_Ð³Ñ€ÑƒÐ´ÐµÐ½ÑŒ'.split('_'),
					'accusative': 'ÑÑ–Ñ‡Ð½Ñ_Ð»ÑŽÑ‚Ð¾Ð³Ð¾_Ð±ÐµÑ€ÐµÐ·Ð½Ñ_ÐºÐ²Ñ–Ñ‚Ð½Ñ_Ñ‚Ñ€Ð°Ð²Ð½Ñ_Ñ‡ÐµÑ€Ð²Ð½Ñ_Ð»Ð¸Ð¿Ð½Ñ_ÑÐµÑ€Ð¿Ð½Ñ_Ð²ÐµÑ€ÐµÑÐ½Ñ_Ð¶Ð¾Ð²Ñ‚Ð½Ñ_Ð»Ð¸ÑÑ‚Ð¾Ð¿Ð°Ð´Ð°_Ð³Ñ€ÑƒÐ´Ð½Ñ'.split('_')
				},

				nounCase = (/D[oD]? *MMMM?/).test(format) ?
					'accusative' :
					'nominative';

			return months[nounCase][m.month()];
		}

		function weekdaysCaseReplace(m, format) {
			var weekdays = {
					'nominative': 'Ð½ÐµÐ´Ñ–Ð»Ñ_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»Ð¾Ðº_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€Ð¾Ðº_ÑÐµÑ€ÐµÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÐµÑ€_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†Ñ_ÑÑƒÐ±Ð¾Ñ‚Ð°'.split('_'),
					'accusative': 'Ð½ÐµÐ´Ñ–Ð»ÑŽ_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»Ð¾Ðº_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€Ð¾Ðº_ÑÐµÑ€ÐµÐ´Ñƒ_Ñ‡ÐµÑ‚Ð²ÐµÑ€_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†ÑŽ_ÑÑƒÐ±Ð¾Ñ‚Ñƒ'.split('_'),
					'genitive': 'Ð½ÐµÐ´Ñ–Ð»Ñ–_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»ÐºÐ°_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€ÐºÐ°_ÑÐµÑ€ÐµÐ´Ð¸_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³Ð°_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†Ñ–_ÑÑƒÐ±Ð¾Ñ‚Ð¸'.split('_')
				},

				nounCase = (/(\[[Ð’Ð²Ð£Ñƒ]\]) ?dddd/).test(format) ?
					'accusative' :
					((/\[?(?:Ð¼Ð¸Ð½ÑƒÐ»Ð¾Ñ—|Ð½Ð°ÑÑ‚ÑƒÐ¿Ð½Ð¾Ñ—)? ?\] ?dddd/).test(format) ?
						'genitive' :
						'nominative');

			return weekdays[nounCase][m.day()];
		}

		function processHoursFunction(str) {
			return function () {
				return str + 'Ð¾' + (this.hours() === 11 ? 'Ð±' : '') + '] LT';
			};
		}

		return moment.lang('uk', {
			months : monthsCaseReplace,
			monthsShort : "ÑÑ–Ñ‡_Ð»ÑŽÑ‚_Ð±ÐµÑ€_ÐºÐ²Ñ–Ñ‚_Ñ‚Ñ€Ð°Ð²_Ñ‡ÐµÑ€Ð²_Ð»Ð¸Ð¿_ÑÐµÑ€Ð¿_Ð²ÐµÑ€_Ð¶Ð¾Ð²Ñ‚_Ð»Ð¸ÑÑ‚_Ð³Ñ€ÑƒÐ´".split("_"),
			weekdays : weekdaysCaseReplace,
			weekdaysShort : "Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
			weekdaysMin : "Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD.MM.YYYY",
				LL : "D MMMM YYYY Ñ€.",
				LLL : "D MMMM YYYY Ñ€., LT",
				LLLL : "dddd, D MMMM YYYY Ñ€., LT"
			},
			calendar : {
				sameDay: processHoursFunction('[Ð¡ÑŒÐ¾Ð³Ð¾Ð´Ð½Ñ– '),
				nextDay: processHoursFunction('[Ð—Ð°Ð²Ñ‚Ñ€Ð° '),
				lastDay: processHoursFunction('[Ð’Ñ‡Ð¾Ñ€Ð° '),
				nextWeek: processHoursFunction('[Ð£] dddd ['),
				lastWeek: function () {
					switch (this.day()) {
						case 0:
						case 3:
						case 5:
						case 6:
							return processHoursFunction('[ÐœÐ¸Ð½ÑƒÐ»Ð¾Ñ—] dddd [').call(this);
						case 1:
						case 2:
						case 4:
							return processHoursFunction('[ÐœÐ¸Ð½ÑƒÐ»Ð¾Ð³Ð¾] dddd [').call(this);
					}
				},
				sameElse: 'L'
			},
			relativeTime : {
				future : "Ð·Ð° %s",
				past : "%s Ñ‚Ð¾Ð¼Ñƒ",
				s : "Ð´ÐµÐºÑ–Ð»ÑŒÐºÐ° ÑÐµÐºÑƒÐ½Ð´",
				m : relativeTimeWithPlural,
				mm : relativeTimeWithPlural,
				h : "Ð³Ð¾Ð´Ð¸Ð½Ñƒ",
				hh : relativeTimeWithPlural,
				d : "Ð´ÐµÐ½ÑŒ",
				dd : relativeTimeWithPlural,
				M : "Ð¼Ñ–ÑÑÑ†ÑŒ",
				MM : relativeTimeWithPlural,
				y : "Ñ€Ñ–Ðº",
				yy : relativeTimeWithPlural
			},

			// M. E.: those two are virtually unused but a user might want to implement them for his/her website for some reason

			meridiem : function (hour, minute, isLower) {
				if (hour < 4) {
					return "Ð½Ð¾Ñ‡Ñ–";
				} else if (hour < 12) {
					return "Ñ€Ð°Ð½ÐºÑƒ";
				} else if (hour < 17) {
					return "Ð´Ð½Ñ";
				} else {
					return "Ð²ÐµÑ‡Ð¾Ñ€Ð°";
				}
			},

			ordinal: function (number, period) {
				switch (period) {
					case 'M':
					case 'd':
					case 'DDD':
					case 'w':
					case 'W':
						return number + '-Ð¹';
					case 'D':
						return number + '-Ð³Ð¾';
					default:
						return number;
				}
			},

			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 1st is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : uzbek
// author : Sardor Muminov : https://github.com/muminoff

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('uz', {
			months : "ÑÐ½Ð²Ð°Ñ€ÑŒ_Ñ„ÐµÐ²Ñ€Ð°Ð»ÑŒ_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€ÐµÐ»ÑŒ_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ½Ñ‚ÑÐ±Ñ€ÑŒ_Ð¾ÐºÑ‚ÑÐ±Ñ€ÑŒ_Ð½Ð¾ÑÐ±Ñ€ÑŒ_Ð´ÐµÐºÐ°Ð±Ñ€ÑŒ".split("_"),
			monthsShort : "ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½_Ð¸ÑŽÐ»_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº".split("_"),
			weekdays : "Ð¯ÐºÑˆÐ°Ð½Ð±Ð°_Ð”ÑƒÑˆÐ°Ð½Ð±Ð°_Ð¡ÐµÑˆÐ°Ð½Ð±Ð°_Ð§Ð¾Ñ€ÑˆÐ°Ð½Ð±Ð°_ÐŸÐ°Ð¹ÑˆÐ°Ð½Ð±Ð°_Ð–ÑƒÐ¼Ð°_Ð¨Ð°Ð½Ð±Ð°".split("_"),
			weekdaysShort : "Ð¯ÐºÑˆ_Ð”ÑƒÑˆ_Ð¡ÐµÑˆ_Ð§Ð¾Ñ€_ÐŸÐ°Ð¹_Ð–ÑƒÐ¼_Ð¨Ð°Ð½".split("_"),
			weekdaysMin : "Ð¯Ðº_Ð”Ñƒ_Ð¡Ðµ_Ð§Ð¾_ÐŸÐ°_Ð–Ñƒ_Ð¨Ð°".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM YYYY",
				LLL : "D MMMM YYYY LT",
				LLLL : "D MMMM YYYY, dddd LT"
			},
			calendar : {
				sameDay : '[Ð‘ÑƒÐ³ÑƒÐ½ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]',
				nextDay : '[Ð­Ñ€Ñ‚Ð°Ð³Ð°] LT [Ð´Ð°]',
				nextWeek : 'dddd [ÐºÑƒÐ½Ð¸ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]',
				lastDay : '[ÐšÐµÑ‡Ð° ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]',
				lastWeek : '[Ð£Ñ‚Ð³Ð°Ð½] dddd [ÐºÑƒÐ½Ð¸ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]',
				sameElse : 'L'
			},
			relativeTime : {
				future : "Ð¯ÐºÐ¸Ð½ %s Ð¸Ñ‡Ð¸Ð´Ð°",
				past : "Ð‘Ð¸Ñ€ Ð½ÐµÑ‡Ð° %s Ð¾Ð»Ð´Ð¸Ð½",
				s : "Ñ„ÑƒÑ€ÑÐ°Ñ‚",
				m : "Ð±Ð¸Ñ€ Ð´Ð°ÐºÐ¸ÐºÐ°",
				mm : "%d Ð´Ð°ÐºÐ¸ÐºÐ°",
				h : "Ð±Ð¸Ñ€ ÑÐ¾Ð°Ñ‚",
				hh : "%d ÑÐ¾Ð°Ñ‚",
				d : "Ð±Ð¸Ñ€ ÐºÑƒÐ½",
				dd : "%d ÐºÑƒÐ½",
				M : "Ð±Ð¸Ñ€ Ð¾Ð¹",
				MM : "%d Ð¾Ð¹",
				y : "Ð±Ð¸Ñ€ Ð¹Ð¸Ð»",
				yy : "%d Ð¹Ð¸Ð»"
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 7  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : vietnamese (vn)
// author : Bang Nguyen : https://github.com/bangnk

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('vn', {
			months : "thÃ¡ng 1_thÃ¡ng 2_thÃ¡ng 3_thÃ¡ng 4_thÃ¡ng 5_thÃ¡ng 6_thÃ¡ng 7_thÃ¡ng 8_thÃ¡ng 9_thÃ¡ng 10_thÃ¡ng 11_thÃ¡ng 12".split("_"),
			monthsShort : "Th01_Th02_Th03_Th04_Th05_Th06_Th07_Th08_Th09_Th10_Th11_Th12".split("_"),
			weekdays : "chá»§ nháº­t_thá»© hai_thá»© ba_thá»© tÆ°_thá»© nÄƒm_thá»© sÃ¡u_thá»© báº£y".split("_"),
			weekdaysShort : "CN_T2_T3_T4_T5_T6_T7".split("_"),
			weekdaysMin : "CN_T2_T3_T4_T5_T6_T7".split("_"),
			longDateFormat : {
				LT : "HH:mm",
				L : "DD/MM/YYYY",
				LL : "D MMMM [nÄƒm] YYYY",
				LLL : "D MMMM [nÄƒm] YYYY LT",
				LLLL : "dddd, D MMMM [nÄƒm] YYYY LT",
				l : "DD/M/YYYY",
				ll : "D MMM YYYY",
				lll : "D MMM YYYY LT",
				llll : "ddd, D MMM YYYY LT"
			},
			calendar : {
				sameDay: "[HÃ´m nay lÃºc] LT",
				nextDay: '[NgÃ y mai lÃºc] LT',
				nextWeek: 'dddd [tuáº§n tá»›i lÃºc] LT',
				lastDay: '[HÃ´m qua lÃºc] LT',
				lastWeek: 'dddd [tuáº§n rá»“i lÃºc] LT',
				sameElse: 'L'
			},
			relativeTime : {
				future : "%s tá»›i",
				past : "%s trÆ°á»›c",
				s : "vÃ i giÃ¢y",
				m : "má»™t phÃºt",
				mm : "%d phÃºt",
				h : "má»™t giá»",
				hh : "%d giá»",
				d : "má»™t ngÃ y",
				dd : "%d ngÃ y",
				M : "má»™t thÃ¡ng",
				MM : "%d thÃ¡ng",
				y : "má»™t nÄƒm",
				yy : "%d nÄƒm"
			},
			ordinal : function (number) {
				return number;
			},
			week : {
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : chinese
// author : suupic : https://github.com/suupic
// author : Zeno Zeng : https://github.com/zenozeng

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('zh-cn', {
			months : "ä¸€æœˆ_äºŒæœˆ_ä¸‰æœˆ_å››æœˆ_äº”æœˆ_å…­æœˆ_ä¸ƒæœˆ_å…«æœˆ_ä¹æœˆ_åæœˆ_åä¸€æœˆ_åäºŒæœˆ".split("_"),
			monthsShort : "1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),
			weekdays : "æ˜ŸæœŸæ—¥_æ˜ŸæœŸä¸€_æ˜ŸæœŸäºŒ_æ˜ŸæœŸä¸‰_æ˜ŸæœŸå››_æ˜ŸæœŸäº”_æ˜ŸæœŸå…­".split("_"),
			weekdaysShort : "å‘¨æ—¥_å‘¨ä¸€_å‘¨äºŒ_å‘¨ä¸‰_å‘¨å››_å‘¨äº”_å‘¨å…­".split("_"),
			weekdaysMin : "æ—¥_ä¸€_äºŒ_ä¸‰_å››_äº”_å…­".split("_"),
			longDateFormat : {
				LT : "Ahç‚¹mm",
				L : "YYYYå¹´MMMDæ—¥",
				LL : "YYYYå¹´MMMDæ—¥",
				LLL : "YYYYå¹´MMMDæ—¥LT",
				LLLL : "YYYYå¹´MMMDæ—¥ddddLT",
				l : "YYYYå¹´MMMDæ—¥",
				ll : "YYYYå¹´MMMDæ—¥",
				lll : "YYYYå¹´MMMDæ—¥LT",
				llll : "YYYYå¹´MMMDæ—¥ddddLT"
			},
			meridiem : function (hour, minute, isLower) {
				var hm = hour * 100 + minute;
				if (hm < 600) {
					return "å‡Œæ™¨";
				} else if (hm < 900) {
					return "æ—©ä¸Š";
				} else if (hm < 1130) {
					return "ä¸Šåˆ";
				} else if (hm < 1230) {
					return "ä¸­åˆ";
				} else if (hm < 1800) {
					return "ä¸‹åˆ";
				} else {
					return "æ™šä¸Š";
				}
			},
			calendar : {
				sameDay : function () {
					return this.minutes() === 0 ? "[ä»Šå¤©]Ah[ç‚¹æ•´]" : "[ä»Šå¤©]LT";
				},
				nextDay : function () {
					return this.minutes() === 0 ? "[æ˜Žå¤©]Ah[ç‚¹æ•´]" : "[æ˜Žå¤©]LT";
				},
				lastDay : function () {
					return this.minutes() === 0 ? "[æ˜¨å¤©]Ah[ç‚¹æ•´]" : "[æ˜¨å¤©]LT";
				},
				nextWeek : function () {
					var startOfWeek, prefix;
					startOfWeek = moment().startOf('week');
					prefix = this.unix() - startOfWeek.unix() >= 7 * 24 * 3600 ? '[ä¸‹]' : '[æœ¬]';
					return this.minutes() === 0 ? prefix + "dddAhç‚¹æ•´" : prefix + "dddAhç‚¹mm";
				},
				lastWeek : function () {
					var startOfWeek, prefix;
					startOfWeek = moment().startOf('week');
					prefix = this.unix() < startOfWeek.unix()  ? '[ä¸Š]' : '[æœ¬]';
					return this.minutes() === 0 ? prefix + "dddAhç‚¹æ•´" : prefix + "dddAhç‚¹mm";
				},
				sameElse : 'L'
			},
			ordinal : function (number, period) {
				switch (period) {
					case "d":
					case "D":
					case "DDD":
						return number + "æ—¥";
					case "M":
						return number + "æœˆ";
					case "w":
					case "W":
						return number + "å‘¨";
					default:
						return number;
				}
			},
			relativeTime : {
				future : "%så†…",
				past : "%så‰",
				s : "å‡ ç§’",
				m : "1åˆ†é’Ÿ",
				mm : "%dåˆ†é’Ÿ",
				h : "1å°æ—¶",
				hh : "%då°æ—¶",
				d : "1å¤©",
				dd : "%då¤©",
				M : "1ä¸ªæœˆ",
				MM : "%dä¸ªæœˆ",
				y : "1å¹´",
				yy : "%då¹´"
			},
			week : {
				// GB/T 7408-1994ã€Šæ•°æ®å…ƒå’Œäº¤æ¢æ ¼å¼Â·ä¿¡æ¯äº¤æ¢Â·æ—¥æœŸå’Œæ—¶é—´è¡¨ç¤ºæ³•ã€‹ä¸ŽISO 8601:1988ç­‰æ•ˆ
				dow : 1, // Monday is the first day of the week.
				doy : 4  // The week that contains Jan 4th is the first week of the year.
			}
		});
	}));
// moment.js language configuration
// language : traditional chinese (zh-tw)
// author : Ben : https://github.com/ben-lin

	(function (factory) {
		factory(moment);
	}(function (moment) {
		return moment.lang('zh-tw', {
			months : "ä¸€æœˆ_äºŒæœˆ_ä¸‰æœˆ_å››æœˆ_äº”æœˆ_å…­æœˆ_ä¸ƒæœˆ_å…«æœˆ_ä¹æœˆ_åæœˆ_åä¸€æœˆ_åäºŒæœˆ".split("_"),
			monthsShort : "1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),
			weekdays : "æ˜ŸæœŸæ—¥_æ˜ŸæœŸä¸€_æ˜ŸæœŸäºŒ_æ˜ŸæœŸä¸‰_æ˜ŸæœŸå››_æ˜ŸæœŸäº”_æ˜ŸæœŸå…­".split("_"),
			weekdaysShort : "é€±æ—¥_é€±ä¸€_é€±äºŒ_é€±ä¸‰_é€±å››_é€±äº”_é€±å…­".split("_"),
			weekdaysMin : "æ—¥_ä¸€_äºŒ_ä¸‰_å››_äº”_å…­".split("_"),
			longDateFormat : {
				LT : "Ahé»žmm",
				L : "YYYYå¹´MMMDæ—¥",
				LL : "YYYYå¹´MMMDæ—¥",
				LLL : "YYYYå¹´MMMDæ—¥LT",
				LLLL : "YYYYå¹´MMMDæ—¥ddddLT",
				l : "YYYYå¹´MMMDæ—¥",
				ll : "YYYYå¹´MMMDæ—¥",
				lll : "YYYYå¹´MMMDæ—¥LT",
				llll : "YYYYå¹´MMMDæ—¥ddddLT"
			},
			meridiem : function (hour, minute, isLower) {
				var hm = hour * 100 + minute;
				if (hm < 900) {
					return "æ—©ä¸Š";
				} else if (hm < 1130) {
					return "ä¸Šåˆ";
				} else if (hm < 1230) {
					return "ä¸­åˆ";
				} else if (hm < 1800) {
					return "ä¸‹åˆ";
				} else {
					return "æ™šä¸Š";
				}
			},
			calendar : {
				sameDay : '[ä»Šå¤©]LT',
				nextDay : '[æ˜Žå¤©]LT',
				nextWeek : '[ä¸‹]ddddLT',
				lastDay : '[æ˜¨å¤©]LT',
				lastWeek : '[ä¸Š]ddddLT',
				sameElse : 'L'
			},
			ordinal : function (number, period) {
				switch (period) {
					case "d" :
					case "D" :
					case "DDD" :
						return number + "æ—¥";
					case "M" :
						return number + "æœˆ";
					case "w" :
					case "W" :
						return number + "é€±";
					default :
						return number;
				}
			},
			relativeTime : {
				future : "%så…§",
				past : "%så‰",
				s : "å¹¾ç§’",
				m : "ä¸€åˆ†é˜",
				mm : "%dåˆ†é˜",
				h : "ä¸€å°æ™‚",
				hh : "%då°æ™‚",
				d : "ä¸€å¤©",
				dd : "%då¤©",
				M : "ä¸€å€‹æœˆ",
				MM : "%då€‹æœˆ",
				y : "ä¸€å¹´",
				yy : "%då¹´"
			}
		});
	}));

	moment.lang('en');


	/************************************
	 Exposing Moment
	 ************************************/

	function makeGlobal(deprecate) {
		var warned = false, local_moment = moment;
		/*global ender:false */
		if (typeof ender !== 'undefined') {
			return;
		}
		// here, `this` means `window` in the browser, or `global` on the server
		// add `moment` as a global object via a string identifier,
		// for Closure Compiler "advanced" mode
		if (deprecate) {
			this.moment = function () {
				if (!warned && console && console.warn) {
					warned = true;
					console.warn(
						"Accessing Moment through the global scope is " +
							"deprecated, and will be removed in an upcoming " +
							"release.");
				}
				return local_moment.apply(null, arguments);
			};
		} else {
			this['moment'] = moment;
		}
	}

	// CommonJS module is defined
	if (hasModule) {
		module.exports = moment;
		makeGlobal(true);
	} else if (typeof define === "function" && define.amd) {
		define("moment", function (require, exports, module) {
			if (module.config().noGlobal !== true) {
				// If user provided noGlobal, he is aware of global
				makeGlobal(module.config().noGlobal === undefined);
			}

			return moment;
		});
	} else {
		makeGlobal();
	}
}).call(this);

define('momentjs', function(require, exports, module) {
module.exports = moment;
});


window.momentjs = require('momentjs');

// ko
define('ko', function(require, exports, module) {
// Knockout JavaScript library v3.0.0
// (c) Steven Sanderson - http://knockoutjs.com/
// License: MIT (http://www.opensource.org/licenses/mit-license.php)

(function(){
var DEBUG=false;
(function(undefined){
    // (0, eval)('this') is a robust way of getting a reference to the global object
    // For details, see http://stackoverflow.com/questions/14119988/return-this-0-evalthis/14120023#14120023
    var window = this || (0, eval)('this'),
        document = window['document'],
        navigator = window['navigator'],
        jQuery = window["jQuery"],
        JSON = window["JSON"];
(function(factory) {
    // Support three module loading scenarios
    if (typeof require === 'function' && typeof exports === 'object' && typeof module === 'object') {
        // [1] CommonJS/Node.js
        var target = module['exports'] || exports; // module.exports is for Node.js
        factory(target);
    } else if (typeof define === 'function' && define['amd']) {
        // [2] AMD anonymous module
        define(['exports'], factory);
    } else {
        // [3] No module loader (plain <script> tag) - put directly in global namespace
        factory(window['ko'] = {});
    }
}(function(koExports){
// Internally, all KO objects are attached to koExports (even the non-exported ones whose names will be minified by the closure compiler).
// In the future, the following "ko" variable may be made distinct from "koExports" so that private objects are not externally reachable.
var ko = typeof koExports !== 'undefined' ? koExports : {};
// Google Closure Compiler helpers (used only to make the minified file smaller)
ko.exportSymbol = function(koPath, object) {
	var tokens = koPath.split(".");

	// In the future, "ko" may become distinct from "koExports" (so that non-exported objects are not reachable)
	// At that point, "target" would be set to: (typeof koExports !== "undefined" ? koExports : ko)
	var target = ko;

	for (var i = 0; i < tokens.length - 1; i++)
		target = target[tokens[i]];
	target[tokens[tokens.length - 1]] = object;
};
ko.exportProperty = function(owner, publicName, object) {
  owner[publicName] = object;
};
ko.version = "3.0.0";

ko.exportSymbol('version', ko.version);
ko.utils = (function () {
    var objectForEach = function(obj, action) {
        for (var prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                action(prop, obj[prop]);
            }
        }
    };

    // Represent the known event types in a compact way, then at runtime transform it into a hash with event name as key (for fast lookup)
    var knownEvents = {}, knownEventTypesByEventName = {};
    var keyEventTypeName = (navigator && /Firefox\/2/i.test(navigator.userAgent)) ? 'KeyboardEvent' : 'UIEvents';
    knownEvents[keyEventTypeName] = ['keyup', 'keydown', 'keypress'];
    knownEvents['MouseEvents'] = ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave'];
    objectForEach(knownEvents, function(eventType, knownEventsForType) {
        if (knownEventsForType.length) {
            for (var i = 0, j = knownEventsForType.length; i < j; i++)
                knownEventTypesByEventName[knownEventsForType[i]] = eventType;
        }
    });
    var eventsThatMustBeRegisteredUsingAttachEvent = { 'propertychange': true }; // Workaround for an IE9 issue - https://github.com/SteveSanderson/knockout/issues/406

    // Detect IE versions for bug workarounds (uses IE conditionals, not UA string, for robustness)
    // Note that, since IE 10 does not support conditional comments, the following logic only detects IE < 10.
    // Currently this is by design, since IE 10+ behaves correctly when treated as a standard browser.
    // If there is a future need to detect specific versions of IE10+, we will amend this.
    var ieVersion = document && (function() {
        var version = 3, div = document.createElement('div'), iElems = div.getElementsByTagName('i');

        // Keep constructing conditional HTML blocks until we hit one that resolves to an empty fragment
        while (
            div.innerHTML = '<!--[if gt IE ' + (++version) + ']><i></i><![endif]-->',
            iElems[0]
        ) {}
        return version > 4 ? version : undefined;
    }());
    var isIe6 = ieVersion === 6,
        isIe7 = ieVersion === 7;

    function isClickOnCheckableElement(element, eventType) {
        if ((ko.utils.tagNameLower(element) !== "input") || !element.type) return false;
        if (eventType.toLowerCase() != "click") return false;
        var inputType = element.type;
        return (inputType == "checkbox") || (inputType == "radio");
    }

    return {
        fieldsIncludedWithJsonPost: ['authenticity_token', /^__RequestVerificationToken(_.*)?$/],

        arrayForEach: function (array, action) {
            for (var i = 0, j = array.length; i < j; i++)
                action(array[i]);
        },

        arrayIndexOf: function (array, item) {
            if (typeof Array.prototype.indexOf == "function")
                return Array.prototype.indexOf.call(array, item);
            for (var i = 0, j = array.length; i < j; i++)
                if (array[i] === item)
                    return i;
            return -1;
        },

        arrayFirst: function (array, predicate, predicateOwner) {
            for (var i = 0, j = array.length; i < j; i++)
                if (predicate.call(predicateOwner, array[i]))
                    return array[i];
            return null;
        },

        arrayRemoveItem: function (array, itemToRemove) {
            var index = ko.utils.arrayIndexOf(array, itemToRemove);
            if (index >= 0)
                array.splice(index, 1);
        },

        arrayGetDistinctValues: function (array) {
            array = array || [];
            var result = [];
            for (var i = 0, j = array.length; i < j; i++) {
                if (ko.utils.arrayIndexOf(result, array[i]) < 0)
                    result.push(array[i]);
            }
            return result;
        },

        arrayMap: function (array, mapping) {
            array = array || [];
            var result = [];
            for (var i = 0, j = array.length; i < j; i++)
                result.push(mapping(array[i]));
            return result;
        },

        arrayFilter: function (array, predicate) {
            array = array || [];
            var result = [];
            for (var i = 0, j = array.length; i < j; i++)
                if (predicate(array[i]))
                    result.push(array[i]);
            return result;
        },

        arrayPushAll: function (array, valuesToPush) {
            if (valuesToPush instanceof Array)
                array.push.apply(array, valuesToPush);
            else
                for (var i = 0, j = valuesToPush.length; i < j; i++)
                    array.push(valuesToPush[i]);
            return array;
        },

        addOrRemoveItem: function(array, value, included) {
            var existingEntryIndex = ko.utils.arrayIndexOf(ko.utils.peekObservable(array), value);
            if (existingEntryIndex < 0) {
                if (included)
                    array.push(value);
            } else {
                if (!included)
                    array.splice(existingEntryIndex, 1);
            }
        },

        extend: function (target, source) {
            if (source) {
                for(var prop in source) {
                    if(source.hasOwnProperty(prop)) {
                        target[prop] = source[prop];
                    }
                }
            }
            return target;
        },

        objectForEach: objectForEach,

        objectMap: function(source, mapping) {
            if (!source)
                return source;
            var target = {};
            for (var prop in source) {
                if (source.hasOwnProperty(prop)) {
                    target[prop] = mapping(source[prop], prop, source);
                }
            }
            return target;
        },

        emptyDomNode: function (domNode) {
            while (domNode.firstChild) {
                ko.removeNode(domNode.firstChild);
            }
        },

        moveCleanedNodesToContainerElement: function(nodes) {
            // Ensure it's a real array, as we're about to reparent the nodes and
            // we don't want the underlying collection to change while we're doing that.
            var nodesArray = ko.utils.makeArray(nodes);

            var container = document.createElement('div');
            for (var i = 0, j = nodesArray.length; i < j; i++) {
                container.appendChild(ko.cleanNode(nodesArray[i]));
            }
            return container;
        },

        cloneNodes: function (nodesArray, shouldCleanNodes) {
            for (var i = 0, j = nodesArray.length, newNodesArray = []; i < j; i++) {
                var clonedNode = nodesArray[i].cloneNode(true);
                newNodesArray.push(shouldCleanNodes ? ko.cleanNode(clonedNode) : clonedNode);
            }
            return newNodesArray;
        },

        setDomNodeChildren: function (domNode, childNodes) {
            ko.utils.emptyDomNode(domNode);
            if (childNodes) {
                for (var i = 0, j = childNodes.length; i < j; i++)
                    domNode.appendChild(childNodes[i]);
            }
        },

        replaceDomNodes: function (nodeToReplaceOrNodeArray, newNodesArray) {
            var nodesToReplaceArray = nodeToReplaceOrNodeArray.nodeType ? [nodeToReplaceOrNodeArray] : nodeToReplaceOrNodeArray;
            if (nodesToReplaceArray.length > 0) {
                var insertionPoint = nodesToReplaceArray[0];
                var parent = insertionPoint.parentNode;
                for (var i = 0, j = newNodesArray.length; i < j; i++)
                    parent.insertBefore(newNodesArray[i], insertionPoint);
                for (var i = 0, j = nodesToReplaceArray.length; i < j; i++) {
                    ko.removeNode(nodesToReplaceArray[i]);
                }
            }
        },

        fixUpContinuousNodeArray: function(continuousNodeArray, parentNode) {
            // Before acting on a set of nodes that were previously outputted by a template function, we have to reconcile
            // them against what is in the DOM right now. It may be that some of the nodes have already been removed, or that
            // new nodes might have been inserted in the middle, for example by a binding. Also, there may previously have been
            // leading comment nodes (created by rewritten string-based templates) that have since been removed during binding.
            // So, this function translates the old "map" output array into its best guess of the set of current DOM nodes.
            //
            // Rules:
            //   [A] Any leading nodes that have been removed should be ignored
            //       These most likely correspond to memoization nodes that were already removed during binding
            //       See https://github.com/SteveSanderson/knockout/pull/440
            //   [B] We want to output a continuous series of nodes. So, ignore any nodes that have already been removed,
            //       and include any nodes that have been inserted among the previous collection

            if (continuousNodeArray.length) {
                // The parent node can be a virtual element; so get the real parent node
                parentNode = (parentNode.nodeType === 8 && parentNode.parentNode) || parentNode;

                // Rule [A]
                while (continuousNodeArray.length && continuousNodeArray[0].parentNode !== parentNode)
                    continuousNodeArray.splice(0, 1);

                // Rule [B]
                if (continuousNodeArray.length > 1) {
                    var current = continuousNodeArray[0], last = continuousNodeArray[continuousNodeArray.length - 1];
                    // Replace with the actual new continuous node set
                    continuousNodeArray.length = 0;
                    while (current !== last) {
                        continuousNodeArray.push(current);
                        current = current.nextSibling;
                        if (!current) // Won't happen, except if the developer has manually removed some DOM elements (then we're in an undefined scenario)
                            return;
                    }
                    continuousNodeArray.push(last);
                }
            }
            return continuousNodeArray;
        },

        setOptionNodeSelectionState: function (optionNode, isSelected) {
            // IE6 sometimes throws "unknown error" if you try to write to .selected directly, whereas Firefox struggles with setAttribute. Pick one based on browser.
            if (ieVersion < 7)
                optionNode.setAttribute("selected", isSelected);
            else
                optionNode.selected = isSelected;
        },

        stringTrim: function (string) {
            return string === null || string === undefined ? '' :
                string.trim ?
                    string.trim() :
                    string.toString().replace(/^[\s\xa0]+|[\s\xa0]+$/g, '');
        },

        stringTokenize: function (string, delimiter) {
            var result = [];
            var tokens = (string || "").split(delimiter);
            for (var i = 0, j = tokens.length; i < j; i++) {
                var trimmed = ko.utils.stringTrim(tokens[i]);
                if (trimmed !== "")
                    result.push(trimmed);
            }
            return result;
        },

        stringStartsWith: function (string, startsWith) {
            string = string || "";
            if (startsWith.length > string.length)
                return false;
            return string.substring(0, startsWith.length) === startsWith;
        },

        domNodeIsContainedBy: function (node, containedByNode) {
            if (node === containedByNode)
                return true;
            if (node.nodeType === 11)
                return false; // Fixes issue #1162 - can't use node.contains for document fragments on IE8
            if (containedByNode.contains)
                return containedByNode.contains(node.nodeType === 3 ? node.parentNode : node);
            if (containedByNode.compareDocumentPosition)
                return (containedByNode.compareDocumentPosition(node) & 16) == 16;
            while (node && node != containedByNode) {
                node = node.parentNode;
            }
            return !!node;
        },

        domNodeIsAttachedToDocument: function (node) {
            return ko.utils.domNodeIsContainedBy(node, node.ownerDocument.documentElement);
        },

        anyDomNodeIsAttachedToDocument: function(nodes) {
            return !!ko.utils.arrayFirst(nodes, ko.utils.domNodeIsAttachedToDocument);
        },

        tagNameLower: function(element) {
            // For HTML elements, tagName will always be upper case; for XHTML elements, it'll be lower case.
            // Possible future optimization: If we know it's an element from an XHTML document (not HTML),
            // we don't need to do the .toLowerCase() as it will always be lower case anyway.
            return element && element.tagName && element.tagName.toLowerCase();
        },

        registerEventHandler: function (element, eventType, handler) {
            var mustUseAttachEvent = ieVersion && eventsThatMustBeRegisteredUsingAttachEvent[eventType];
            if (!mustUseAttachEvent && typeof jQuery != "undefined") {
                if (isClickOnCheckableElement(element, eventType)) {
                    // For click events on checkboxes, jQuery interferes with the event handling in an awkward way:
                    // it toggles the element checked state *after* the click event handlers run, whereas native
                    // click events toggle the checked state *before* the event handler.
                    // Fix this by intecepting the handler and applying the correct checkedness before it runs.
                    var originalHandler = handler;
                    handler = function(event, eventData) {
                        var jQuerySuppliedCheckedState = this.checked;
                        if (eventData)
                            this.checked = eventData.checkedStateBeforeEvent !== true;
                        originalHandler.call(this, event);
                        this.checked = jQuerySuppliedCheckedState; // Restore the state jQuery applied
                    };
                }
                jQuery(element)['bind'](eventType, handler);
            } else if (!mustUseAttachEvent && typeof element.addEventListener == "function")
                element.addEventListener(eventType, handler, false);
            else if (typeof element.attachEvent != "undefined") {
                var attachEventHandler = function (event) { handler.call(element, event); },
                    attachEventName = "on" + eventType;
                element.attachEvent(attachEventName, attachEventHandler);

                // IE does not dispose attachEvent handlers automatically (unlike with addEventListener)
                // so to avoid leaks, we have to remove them manually. See bug #856
                ko.utils.domNodeDisposal.addDisposeCallback(element, function() {
                    element.detachEvent(attachEventName, attachEventHandler);
                });
            } else
                throw new Error("Browser doesn't support addEventListener or attachEvent");
        },

        triggerEvent: function (element, eventType) {
            if (!(element && element.nodeType))
                throw new Error("element must be a DOM node when calling triggerEvent");

            if (typeof jQuery != "undefined") {
                var eventData = [];
                if (isClickOnCheckableElement(element, eventType)) {
                    // Work around the jQuery "click events on checkboxes" issue described above by storing the original checked state before triggering the handler
                    eventData.push({ checkedStateBeforeEvent: element.checked });
                }
                jQuery(element)['trigger'](eventType, eventData);
            } else if (typeof document.createEvent == "function") {
                if (typeof element.dispatchEvent == "function") {
                    var eventCategory = knownEventTypesByEventName[eventType] || "HTMLEvents";
                    var event = document.createEvent(eventCategory);
                    event.initEvent(eventType, true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, element);
                    element.dispatchEvent(event);
                }
                else
                    throw new Error("The supplied element doesn't support dispatchEvent");
            } else if (typeof element.fireEvent != "undefined") {
                // Unlike other browsers, IE doesn't change the checked state of checkboxes/radiobuttons when you trigger their "click" event
                // so to make it consistent, we'll do it manually here
                if (isClickOnCheckableElement(element, eventType))
                    element.checked = element.checked !== true;
                element.fireEvent("on" + eventType);
            }
            else
                throw new Error("Browser doesn't support triggering events");
        },

        unwrapObservable: function (value) {
            return ko.isObservable(value) ? value() : value;
        },

        peekObservable: function (value) {
            return ko.isObservable(value) ? value.peek() : value;
        },

        toggleDomNodeCssClass: function (node, classNames, shouldHaveClass) {
            if (classNames) {
                var cssClassNameRegex = /\S+/g,
                    currentClassNames = node.className.match(cssClassNameRegex) || [];
                ko.utils.arrayForEach(classNames.match(cssClassNameRegex), function(className) {
                    ko.utils.addOrRemoveItem(currentClassNames, className, shouldHaveClass);
                });
                node.className = currentClassNames.join(" ");
            }
        },

        setTextContent: function(element, textContent) {
            var value = ko.utils.unwrapObservable(textContent);
            if ((value === null) || (value === undefined))
                value = "";

            // We need there to be exactly one child: a text node.
            // If there are no children, more than one, or if it's not a text node,
            // we'll clear everything and create a single text node.
            var innerTextNode = ko.virtualElements.firstChild(element);
            if (!innerTextNode || innerTextNode.nodeType != 3 || ko.virtualElements.nextSibling(innerTextNode)) {
                ko.virtualElements.setDomNodeChildren(element, [document.createTextNode(value)]);
            } else {
                innerTextNode.data = value;
            }

            ko.utils.forceRefresh(element);
        },

        setElementName: function(element, name) {
            element.name = name;

            // Workaround IE 6/7 issue
            // - https://github.com/SteveSanderson/knockout/issues/197
            // - http://www.matts411.com/post/setting_the_name_attribute_in_ie_dom/
            if (ieVersion <= 7) {
                try {
                    element.mergeAttributes(document.createElement("<input name='" + element.name + "'/>"), false);
                }
                catch(e) {} // For IE9 with doc mode "IE9 Standards" and browser mode "IE9 Compatibility View"
            }
        },

        forceRefresh: function(node) {
            // Workaround for an IE9 rendering bug - https://github.com/SteveSanderson/knockout/issues/209
            if (ieVersion >= 9) {
                // For text nodes and comment nodes (most likely virtual elements), we will have to refresh the container
                var elem = node.nodeType == 1 ? node : node.parentNode;
                if (elem.style)
                    elem.style.zoom = elem.style.zoom;
            }
        },

        ensureSelectElementIsRenderedCorrectly: function(selectElement) {
            // Workaround for IE9 rendering bug - it doesn't reliably display all the text in dynamically-added select boxes unless you force it to re-render by updating the width.
            // (See https://github.com/SteveSanderson/knockout/issues/312, http://stackoverflow.com/questions/5908494/select-only-shows-first-char-of-selected-option)
            // Also fixes IE7 and IE8 bug that causes selects to be zero width if enclosed by 'if' or 'with'. (See issue #839)
            if (ieVersion) {
                var originalWidth = selectElement.style.width;
                selectElement.style.width = 0;
                selectElement.style.width = originalWidth;
            }
        },

        range: function (min, max) {
            min = ko.utils.unwrapObservable(min);
            max = ko.utils.unwrapObservable(max);
            var result = [];
            for (var i = min; i <= max; i++)
                result.push(i);
            return result;
        },

        makeArray: function(arrayLikeObject) {
            var result = [];
            for (var i = 0, j = arrayLikeObject.length; i < j; i++) {
                result.push(arrayLikeObject[i]);
            };
            return result;
        },

        isIe6 : isIe6,
        isIe7 : isIe7,
        ieVersion : ieVersion,

        getFormFields: function(form, fieldName) {
            var fields = ko.utils.makeArray(form.getElementsByTagName("input")).concat(ko.utils.makeArray(form.getElementsByTagName("textarea")));
            var isMatchingField = (typeof fieldName == 'string')
                ? function(field) { return field.name === fieldName }
                : function(field) { return fieldName.test(field.name) }; // Treat fieldName as regex or object containing predicate
            var matches = [];
            for (var i = fields.length - 1; i >= 0; i--) {
                if (isMatchingField(fields[i]))
                    matches.push(fields[i]);
            };
            return matches;
        },

        parseJson: function (jsonString) {
            if (typeof jsonString == "string") {
                jsonString = ko.utils.stringTrim(jsonString);
                if (jsonString) {
                    if (JSON && JSON.parse) // Use native parsing where available
                        return JSON.parse(jsonString);
                    return (new Function("return " + jsonString))(); // Fallback on less safe parsing for older browsers
                }
            }
            return null;
        },

        stringifyJson: function (data, replacer, space) {   // replacer and space are optional
            if (!JSON || !JSON.stringify)
                throw new Error("Cannot find JSON.stringify(). Some browsers (e.g., IE < 8) don't support it natively, but you can overcome this by adding a script reference to json2.js, downloadable from http://www.json.org/json2.js");
            return JSON.stringify(ko.utils.unwrapObservable(data), replacer, space);
        },

        postJson: function (urlOrForm, data, options) {
            options = options || {};
            var params = options['params'] || {};
            var includeFields = options['includeFields'] || this.fieldsIncludedWithJsonPost;
            var url = urlOrForm;

            // If we were given a form, use its 'action' URL and pick out any requested field values
            if((typeof urlOrForm == 'object') && (ko.utils.tagNameLower(urlOrForm) === "form")) {
                var originalForm = urlOrForm;
                url = originalForm.action;
                for (var i = includeFields.length - 1; i >= 0; i--) {
                    var fields = ko.utils.getFormFields(originalForm, includeFields[i]);
                    for (var j = fields.length - 1; j >= 0; j--)
                        params[fields[j].name] = fields[j].value;
                }
            }

            data = ko.utils.unwrapObservable(data);
            var form = document.createElement("form");
            form.style.display = "none";
            form.action = url;
            form.method = "post";
            for (var key in data) {
                // Since 'data' this is a model object, we include all properties including those inherited from its prototype
                var input = document.createElement("input");
                input.name = key;
                input.value = ko.utils.stringifyJson(ko.utils.unwrapObservable(data[key]));
                form.appendChild(input);
            }
            objectForEach(params, function(key, value) {
                var input = document.createElement("input");
                input.name = key;
                input.value = value;
                form.appendChild(input);
            });
            document.body.appendChild(form);
            options['submitter'] ? options['submitter'](form) : form.submit();
            setTimeout(function () { form.parentNode.removeChild(form); }, 0);
        }
    }
}());

ko.exportSymbol('utils', ko.utils);
ko.exportSymbol('utils.arrayForEach', ko.utils.arrayForEach);
ko.exportSymbol('utils.arrayFirst', ko.utils.arrayFirst);
ko.exportSymbol('utils.arrayFilter', ko.utils.arrayFilter);
ko.exportSymbol('utils.arrayGetDistinctValues', ko.utils.arrayGetDistinctValues);
ko.exportSymbol('utils.arrayIndexOf', ko.utils.arrayIndexOf);
ko.exportSymbol('utils.arrayMap', ko.utils.arrayMap);
ko.exportSymbol('utils.arrayPushAll', ko.utils.arrayPushAll);
ko.exportSymbol('utils.arrayRemoveItem', ko.utils.arrayRemoveItem);
ko.exportSymbol('utils.extend', ko.utils.extend);
ko.exportSymbol('utils.fieldsIncludedWithJsonPost', ko.utils.fieldsIncludedWithJsonPost);
ko.exportSymbol('utils.getFormFields', ko.utils.getFormFields);
ko.exportSymbol('utils.peekObservable', ko.utils.peekObservable);
ko.exportSymbol('utils.postJson', ko.utils.postJson);
ko.exportSymbol('utils.parseJson', ko.utils.parseJson);
ko.exportSymbol('utils.registerEventHandler', ko.utils.registerEventHandler);
ko.exportSymbol('utils.stringifyJson', ko.utils.stringifyJson);
ko.exportSymbol('utils.range', ko.utils.range);
ko.exportSymbol('utils.toggleDomNodeCssClass', ko.utils.toggleDomNodeCssClass);
ko.exportSymbol('utils.triggerEvent', ko.utils.triggerEvent);
ko.exportSymbol('utils.unwrapObservable', ko.utils.unwrapObservable);
ko.exportSymbol('utils.objectForEach', ko.utils.objectForEach);
ko.exportSymbol('utils.addOrRemoveItem', ko.utils.addOrRemoveItem);
ko.exportSymbol('unwrap', ko.utils.unwrapObservable); // Convenient shorthand, because this is used so commonly

if (!Function.prototype['bind']) {
    // Function.prototype.bind is a standard part of ECMAScript 5th Edition (December 2009, http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-262.pdf)
    // In case the browser doesn't implement it natively, provide a JavaScript implementation. This implementation is based on the one in prototype.js
    Function.prototype['bind'] = function (object) {
        var originalFunction = this, args = Array.prototype.slice.call(arguments), object = args.shift();
        return function () {
            return originalFunction.apply(object, args.concat(Array.prototype.slice.call(arguments)));
        };
    };
}

ko.utils.domData = new (function () {
    var uniqueId = 0;
    var dataStoreKeyExpandoPropertyName = "__ko__" + (new Date).getTime();
    var dataStore = {};

    function getAll(node, createIfNotFound) {
        var dataStoreKey = node[dataStoreKeyExpandoPropertyName];
        var hasExistingDataStore = dataStoreKey && (dataStoreKey !== "null") && dataStore[dataStoreKey];
        if (!hasExistingDataStore) {
            if (!createIfNotFound)
                return undefined;
            dataStoreKey = node[dataStoreKeyExpandoPropertyName] = "ko" + uniqueId++;
            dataStore[dataStoreKey] = {};
        }
        return dataStore[dataStoreKey];
    }

    return {
        get: function (node, key) {
            var allDataForNode = getAll(node, false);
            return allDataForNode === undefined ? undefined : allDataForNode[key];
        },
        set: function (node, key, value) {
            if (value === undefined) {
                // Make sure we don't actually create a new domData key if we are actually deleting a value
                if (getAll(node, false) === undefined)
                    return;
            }
            var allDataForNode = getAll(node, true);
            allDataForNode[key] = value;
        },
        clear: function (node) {
            var dataStoreKey = node[dataStoreKeyExpandoPropertyName];
            if (dataStoreKey) {
                delete dataStore[dataStoreKey];
                node[dataStoreKeyExpandoPropertyName] = null;
                return true; // Exposing "did clean" flag purely so specs can infer whether things have been cleaned up as intended
            }
            return false;
        },

        nextKey: function () {
            return (uniqueId++) + dataStoreKeyExpandoPropertyName;
        }
    };
})();

ko.exportSymbol('utils.domData', ko.utils.domData);
ko.exportSymbol('utils.domData.clear', ko.utils.domData.clear); // Exporting only so specs can clear up after themselves fully

ko.utils.domNodeDisposal = new (function () {
    var domDataKey = ko.utils.domData.nextKey();
    var cleanableNodeTypes = { 1: true, 8: true, 9: true };       // Element, Comment, Document
    var cleanableNodeTypesWithDescendants = { 1: true, 9: true }; // Element, Document

    function getDisposeCallbacksCollection(node, createIfNotFound) {
        var allDisposeCallbacks = ko.utils.domData.get(node, domDataKey);
        if ((allDisposeCallbacks === undefined) && createIfNotFound) {
            allDisposeCallbacks = [];
            ko.utils.domData.set(node, domDataKey, allDisposeCallbacks);
        }
        return allDisposeCallbacks;
    }
    function destroyCallbacksCollection(node) {
        ko.utils.domData.set(node, domDataKey, undefined);
    }

    function cleanSingleNode(node) {
        // Run all the dispose callbacks
        var callbacks = getDisposeCallbacksCollection(node, false);
        if (callbacks) {
            callbacks = callbacks.slice(0); // Clone, as the array may be modified during iteration (typically, callbacks will remove themselves)
            for (var i = 0; i < callbacks.length; i++)
                callbacks[i](node);
        }

        // Also erase the DOM data
        ko.utils.domData.clear(node);

        // Special support for jQuery here because it's so commonly used.
        // Many jQuery plugins (including jquery.tmpl) store data using jQuery's equivalent of domData
        // so notify it to tear down any resources associated with the node & descendants here.
        if ((typeof jQuery == "function") && (typeof jQuery['cleanData'] == "function"))
            jQuery['cleanData']([node]);

        // Also clear any immediate-child comment nodes, as these wouldn't have been found by
        // node.getElementsByTagName("*") in cleanNode() (comment nodes aren't elements)
        if (cleanableNodeTypesWithDescendants[node.nodeType])
            cleanImmediateCommentTypeChildren(node);
    }

    function cleanImmediateCommentTypeChildren(nodeWithChildren) {
        var child, nextChild = nodeWithChildren.firstChild;
        while (child = nextChild) {
            nextChild = child.nextSibling;
            if (child.nodeType === 8)
                cleanSingleNode(child);
        }
    }

    return {
        addDisposeCallback : function(node, callback) {
            if (typeof callback != "function")
                throw new Error("Callback must be a function");
            getDisposeCallbacksCollection(node, true).push(callback);
        },

        removeDisposeCallback : function(node, callback) {
            var callbacksCollection = getDisposeCallbacksCollection(node, false);
            if (callbacksCollection) {
                ko.utils.arrayRemoveItem(callbacksCollection, callback);
                if (callbacksCollection.length == 0)
                    destroyCallbacksCollection(node);
            }
        },

        cleanNode : function(node) {
            // First clean this node, where applicable
            if (cleanableNodeTypes[node.nodeType]) {
                cleanSingleNode(node);

                // ... then its descendants, where applicable
                if (cleanableNodeTypesWithDescendants[node.nodeType]) {
                    // Clone the descendants list in case it changes during iteration
                    var descendants = [];
                    ko.utils.arrayPushAll(descendants, node.getElementsByTagName("*"));
                    for (var i = 0, j = descendants.length; i < j; i++)
                        cleanSingleNode(descendants[i]);
                }
            }
            return node;
        },

        removeNode : function(node) {
            ko.cleanNode(node);
            if (node.parentNode)
                node.parentNode.removeChild(node);
        }
    }
})();
ko.cleanNode = ko.utils.domNodeDisposal.cleanNode; // Shorthand name for convenience
ko.removeNode = ko.utils.domNodeDisposal.removeNode; // Shorthand name for convenience
ko.exportSymbol('cleanNode', ko.cleanNode);
ko.exportSymbol('removeNode', ko.removeNode);
ko.exportSymbol('utils.domNodeDisposal', ko.utils.domNodeDisposal);
ko.exportSymbol('utils.domNodeDisposal.addDisposeCallback', ko.utils.domNodeDisposal.addDisposeCallback);
ko.exportSymbol('utils.domNodeDisposal.removeDisposeCallback', ko.utils.domNodeDisposal.removeDisposeCallback);
(function () {
    var leadingCommentRegex = /^(\s*)<!--(.*?)-->/;

    function simpleHtmlParse(html) {
        // Based on jQuery's "clean" function, but only accounting for table-related elements.
        // If you have referenced jQuery, this won't be used anyway - KO will use jQuery's "clean" function directly

        // Note that there's still an issue in IE < 9 whereby it will discard comment nodes that are the first child of
        // a descendant node. For example: "<div><!-- mycomment -->abc</div>" will get parsed as "<div>abc</div>"
        // This won't affect anyone who has referenced jQuery, and there's always the workaround of inserting a dummy node
        // (possibly a text node) in front of the comment. So, KO does not attempt to workaround this IE issue automatically at present.

        // Trim whitespace, otherwise indexOf won't work as expected
        var tags = ko.utils.stringTrim(html).toLowerCase(), div = document.createElement("div");

        // Finds the first match from the left column, and returns the corresponding "wrap" data from the right column
        var wrap = tags.match(/^<(thead|tbody|tfoot)/)              && [1, "<table>", "</table>"] ||
                   !tags.indexOf("<tr")                             && [2, "<table><tbody>", "</tbody></table>"] ||
                   (!tags.indexOf("<td") || !tags.indexOf("<th"))   && [3, "<table><tbody><tr>", "</tr></tbody></table>"] ||
                   /* anything else */                                 [0, "", ""];

        // Go to html and back, then peel off extra wrappers
        // Note that we always prefix with some dummy text, because otherwise, IE<9 will strip out leading comment nodes in descendants. Total madness.
        var markup = "ignored<div>" + wrap[1] + html + wrap[2] + "</div>";
        if (typeof window['innerShiv'] == "function") {
            div.appendChild(window['innerShiv'](markup));
        } else {
            div.innerHTML = markup;
        }

        // Move to the right depth
        while (wrap[0]--)
            div = div.lastChild;

        return ko.utils.makeArray(div.lastChild.childNodes);
    }

    function jQueryHtmlParse(html) {
        // jQuery's "parseHTML" function was introduced in jQuery 1.8.0 and is a documented public API.
        if (jQuery['parseHTML']) {
            return jQuery['parseHTML'](html) || []; // Ensure we always return an array and never null
        } else {
            // For jQuery < 1.8.0, we fall back on the undocumented internal "clean" function.
            var elems = jQuery['clean']([html]);

            // As of jQuery 1.7.1, jQuery parses the HTML by appending it to some dummy parent nodes held in an in-memory document fragment.
            // Unfortunately, it never clears the dummy parent nodes from the document fragment, so it leaks memory over time.
            // Fix this by finding the top-most dummy parent element, and detaching it from its owner fragment.
            if (elems && elems[0]) {
                // Find the top-most parent element that's a direct child of a document fragment
                var elem = elems[0];
                while (elem.parentNode && elem.parentNode.nodeType !== 11 /* i.e., DocumentFragment */)
                    elem = elem.parentNode;
                // ... then detach it
                if (elem.parentNode)
                    elem.parentNode.removeChild(elem);
            }

            return elems;
        }
    }

    ko.utils.parseHtmlFragment = function(html) {
        return typeof jQuery != 'undefined' ? jQueryHtmlParse(html)   // As below, benefit from jQuery's optimisations where possible
                                            : simpleHtmlParse(html);  // ... otherwise, this simple logic will do in most common cases.
    };

    ko.utils.setHtml = function(node, html) {
        ko.utils.emptyDomNode(node);

        // There's no legitimate reason to display a stringified observable without unwrapping it, so we'll unwrap it
        html = ko.utils.unwrapObservable(html);

        if ((html !== null) && (html !== undefined)) {
            if (typeof html != 'string')
                html = html.toString();

            // jQuery contains a lot of sophisticated code to parse arbitrary HTML fragments,
            // for example <tr> elements which are not normally allowed to exist on their own.
            // If you've referenced jQuery we'll use that rather than duplicating its code.
            if (typeof jQuery != 'undefined') {
                jQuery(node)['html'](html);
            } else {
                // ... otherwise, use KO's own parsing logic.
                var parsedNodes = ko.utils.parseHtmlFragment(html);
                for (var i = 0; i < parsedNodes.length; i++)
                    node.appendChild(parsedNodes[i]);
            }
        }
    };
})();

ko.exportSymbol('utils.parseHtmlFragment', ko.utils.parseHtmlFragment);
ko.exportSymbol('utils.setHtml', ko.utils.setHtml);

ko.memoization = (function () {
    var memos = {};

    function randomMax8HexChars() {
        return (((1 + Math.random()) * 0x100000000) | 0).toString(16).substring(1);
    }
    function generateRandomId() {
        return randomMax8HexChars() + randomMax8HexChars();
    }
    function findMemoNodes(rootNode, appendToArray) {
        if (!rootNode)
            return;
        if (rootNode.nodeType == 8) {
            var memoId = ko.memoization.parseMemoText(rootNode.nodeValue);
            if (memoId != null)
                appendToArray.push({ domNode: rootNode, memoId: memoId });
        } else if (rootNode.nodeType == 1) {
            for (var i = 0, childNodes = rootNode.childNodes, j = childNodes.length; i < j; i++)
                findMemoNodes(childNodes[i], appendToArray);
        }
    }

    return {
        memoize: function (callback) {
            if (typeof callback != "function")
                throw new Error("You can only pass a function to ko.memoization.memoize()");
            var memoId = generateRandomId();
            memos[memoId] = callback;
            return "<!--[ko_memo:" + memoId + "]-->";
        },

        unmemoize: function (memoId, callbackParams) {
            var callback = memos[memoId];
            if (callback === undefined)
                throw new Error("Couldn't find any memo with ID " + memoId + ". Perhaps it's already been unmemoized.");
            try {
                callback.apply(null, callbackParams || []);
                return true;
            }
            finally { delete memos[memoId]; }
        },

        unmemoizeDomNodeAndDescendants: function (domNode, extraCallbackParamsArray) {
            var memos = [];
            findMemoNodes(domNode, memos);
            for (var i = 0, j = memos.length; i < j; i++) {
                var node = memos[i].domNode;
                var combinedParams = [node];
                if (extraCallbackParamsArray)
                    ko.utils.arrayPushAll(combinedParams, extraCallbackParamsArray);
                ko.memoization.unmemoize(memos[i].memoId, combinedParams);
                node.nodeValue = ""; // Neuter this node so we don't try to unmemoize it again
                if (node.parentNode)
                    node.parentNode.removeChild(node); // If possible, erase it totally (not always possible - someone else might just hold a reference to it then call unmemoizeDomNodeAndDescendants again)
            }
        },

        parseMemoText: function (memoText) {
            var match = memoText.match(/^\[ko_memo\:(.*?)\]$/);
            return match ? match[1] : null;
        }
    };
})();

ko.exportSymbol('memoization', ko.memoization);
ko.exportSymbol('memoization.memoize', ko.memoization.memoize);
ko.exportSymbol('memoization.unmemoize', ko.memoization.unmemoize);
ko.exportSymbol('memoization.parseMemoText', ko.memoization.parseMemoText);
ko.exportSymbol('memoization.unmemoizeDomNodeAndDescendants', ko.memoization.unmemoizeDomNodeAndDescendants);
ko.extenders = {
    'throttle': function(target, timeout) {
        // Throttling means two things:

        // (1) For dependent observables, we throttle *evaluations* so that, no matter how fast its dependencies
        //     notify updates, the target doesn't re-evaluate (and hence doesn't notify) faster than a certain rate
        target['throttleEvaluation'] = timeout;

        // (2) For writable targets (observables, or writable dependent observables), we throttle *writes*
        //     so the target cannot change value synchronously or faster than a certain rate
        var writeTimeoutInstance = null;
        return ko.dependentObservable({
            'read': target,
            'write': function(value) {
                clearTimeout(writeTimeoutInstance);
                writeTimeoutInstance = setTimeout(function() {
                    target(value);
                }, timeout);
            }
        });
    },

    'notify': function(target, notifyWhen) {
        target["equalityComparer"] = notifyWhen == "always" ?
            null :  // null equalityComparer means to always notify
            valuesArePrimitiveAndEqual;
    }
};

var primitiveTypes = { 'undefined':1, 'boolean':1, 'number':1, 'string':1 };
function valuesArePrimitiveAndEqual(a, b) {
    var oldValueIsPrimitive = (a === null) || (typeof(a) in primitiveTypes);
    return oldValueIsPrimitive ? (a === b) : false;
}

function applyExtenders(requestedExtenders) {
    var target = this;
    if (requestedExtenders) {
        ko.utils.objectForEach(requestedExtenders, function(key, value) {
            var extenderHandler = ko.extenders[key];
            if (typeof extenderHandler == 'function') {
                target = extenderHandler(target, value) || target;
            }
        });
    }
    return target;
}

ko.exportSymbol('extenders', ko.extenders);

ko.subscription = function (target, callback, disposeCallback) {
    this.target = target;
    this.callback = callback;
    this.disposeCallback = disposeCallback;
    ko.exportProperty(this, 'dispose', this.dispose);
};
ko.subscription.prototype.dispose = function () {
    this.isDisposed = true;
    this.disposeCallback();
};

ko.subscribable = function () {
    this._subscriptions = {};

    ko.utils.extend(this, ko.subscribable['fn']);
    ko.exportProperty(this, 'subscribe', this.subscribe);
    ko.exportProperty(this, 'extend', this.extend);
    ko.exportProperty(this, 'getSubscriptionsCount', this.getSubscriptionsCount);
}

var defaultEvent = "change";

ko.subscribable['fn'] = {
    subscribe: function (callback, callbackTarget, event) {
        event = event || defaultEvent;
        var boundCallback = callbackTarget ? callback.bind(callbackTarget) : callback;

        var subscription = new ko.subscription(this, boundCallback, function () {
            ko.utils.arrayRemoveItem(this._subscriptions[event], subscription);
        }.bind(this));

        if (!this._subscriptions[event])
            this._subscriptions[event] = [];
        this._subscriptions[event].push(subscription);
        return subscription;
    },

    "notifySubscribers": function (valueToNotify, event) {
        event = event || defaultEvent;
        if (this.hasSubscriptionsForEvent(event)) {
            try {
                ko.dependencyDetection.begin();
                for (var a = this._subscriptions[event].slice(0), i = 0, subscription; subscription = a[i]; ++i) {
                    // In case a subscription was disposed during the arrayForEach cycle, check
                    // for isDisposed on each subscription before invoking its callback
                    if (subscription && (subscription.isDisposed !== true))
                        subscription.callback(valueToNotify);
                }
            } finally {
                ko.dependencyDetection.end();
            }
        }
    },

    hasSubscriptionsForEvent: function(event) {
        return this._subscriptions[event] && this._subscriptions[event].length;
    },

    getSubscriptionsCount: function () {
        var total = 0;
        ko.utils.objectForEach(this._subscriptions, function(eventName, subscriptions) {
            total += subscriptions.length;
        });
        return total;
    },

    extend: applyExtenders
};


ko.isSubscribable = function (instance) {
    return instance != null && typeof instance.subscribe == "function" && typeof instance["notifySubscribers"] == "function";
};

ko.exportSymbol('subscribable', ko.subscribable);
ko.exportSymbol('isSubscribable', ko.isSubscribable);

ko.dependencyDetection = (function () {
    var _frames = [];

    return {
        begin: function (callback) {
            _frames.push(callback && { callback: callback, distinctDependencies:[] });
        },

        end: function () {
            _frames.pop();
        },

        registerDependency: function (subscribable) {
            if (!ko.isSubscribable(subscribable))
                throw new Error("Only subscribable things can act as dependencies");
            if (_frames.length > 0) {
                var topFrame = _frames[_frames.length - 1];
                if (!topFrame || ko.utils.arrayIndexOf(topFrame.distinctDependencies, subscribable) >= 0)
                    return;
                topFrame.distinctDependencies.push(subscribable);
                topFrame.callback(subscribable);
            }
        },

        ignore: function(callback, callbackTarget, callbackArgs) {
            try {
                _frames.push(null);
                return callback.apply(callbackTarget, callbackArgs || []);
            } finally {
                _frames.pop();
            }
        }
    };
})();
ko.observable = function (initialValue) {
    var _latestValue = initialValue;

    function observable() {
        if (arguments.length > 0) {
            // Write

            // Ignore writes if the value hasn't changed
            if (!observable['equalityComparer'] || !observable['equalityComparer'](_latestValue, arguments[0])) {
                observable.valueWillMutate();
                _latestValue = arguments[0];
                if (DEBUG) observable._latestValue = _latestValue;
                observable.valueHasMutated();
            }
            return this; // Permits chained assignments
        }
        else {
            // Read
            ko.dependencyDetection.registerDependency(observable); // The caller only needs to be notified of changes if they did a "read" operation
            return _latestValue;
        }
    }
    if (DEBUG) observable._latestValue = _latestValue;
    ko.subscribable.call(observable);
    observable.peek = function() { return _latestValue };
    observable.valueHasMutated = function () { observable["notifySubscribers"](_latestValue); }
    observable.valueWillMutate = function () { observable["notifySubscribers"](_latestValue, "beforeChange"); }
    ko.utils.extend(observable, ko.observable['fn']);

    ko.exportProperty(observable, 'peek', observable.peek);
    ko.exportProperty(observable, "valueHasMutated", observable.valueHasMutated);
    ko.exportProperty(observable, "valueWillMutate", observable.valueWillMutate);

    return observable;
}

ko.observable['fn'] = {
    "equalityComparer": valuesArePrimitiveAndEqual
};

var protoProperty = ko.observable.protoProperty = "__ko_proto__";
ko.observable['fn'][protoProperty] = ko.observable;

ko.hasPrototype = function(instance, prototype) {
    if ((instance === null) || (instance === undefined) || (instance[protoProperty] === undefined)) return false;
    if (instance[protoProperty] === prototype) return true;
    return ko.hasPrototype(instance[protoProperty], prototype); // Walk the prototype chain
};

ko.isObservable = function (instance) {
    return ko.hasPrototype(instance, ko.observable);
}
ko.isWriteableObservable = function (instance) {
    // Observable
    if ((typeof instance == "function") && instance[protoProperty] === ko.observable)
        return true;
    // Writeable dependent observable
    if ((typeof instance == "function") && (instance[protoProperty] === ko.dependentObservable) && (instance.hasWriteFunction))
        return true;
    // Anything else
    return false;
}


ko.exportSymbol('observable', ko.observable);
ko.exportSymbol('isObservable', ko.isObservable);
ko.exportSymbol('isWriteableObservable', ko.isWriteableObservable);
ko.observableArray = function (initialValues) {
    initialValues = initialValues || [];

    if (typeof initialValues != 'object' || !('length' in initialValues))
        throw new Error("The argument passed when initializing an observable array must be an array, or null, or undefined.");

    var result = ko.observable(initialValues);
    ko.utils.extend(result, ko.observableArray['fn']);
    return result.extend({'trackArrayChanges':true});
};

ko.observableArray['fn'] = {
    'remove': function (valueOrPredicate) {
        var underlyingArray = this.peek();
        var removedValues = [];
        var predicate = typeof valueOrPredicate == "function" && !ko.isObservable(valueOrPredicate) ? valueOrPredicate : function (value) { return value === valueOrPredicate; };
        for (var i = 0; i < underlyingArray.length; i++) {
            var value = underlyingArray[i];
            if (predicate(value)) {
                if (removedValues.length === 0) {
                    this.valueWillMutate();
                }
                removedValues.push(value);
                underlyingArray.splice(i, 1);
                i--;
            }
        }
        if (removedValues.length) {
            this.valueHasMutated();
        }
        return removedValues;
    },

    'removeAll': function (arrayOfValues) {
        // If you passed zero args, we remove everything
        if (arrayOfValues === undefined) {
            var underlyingArray = this.peek();
            var allValues = underlyingArray.slice(0);
            this.valueWillMutate();
            underlyingArray.splice(0, underlyingArray.length);
            this.valueHasMutated();
            return allValues;
        }
        // If you passed an arg, we interpret it as an array of entries to remove
        if (!arrayOfValues)
            return [];
        return this['remove'](function (value) {
            return ko.utils.arrayIndexOf(arrayOfValues, value) >= 0;
        });
    },

    'destroy': function (valueOrPredicate) {
        var underlyingArray = this.peek();
        var predicate = typeof valueOrPredicate == "function" && !ko.isObservable(valueOrPredicate) ? valueOrPredicate : function (value) { return value === valueOrPredicate; };
        this.valueWillMutate();
        for (var i = underlyingArray.length - 1; i >= 0; i--) {
            var value = underlyingArray[i];
            if (predicate(value))
                underlyingArray[i]["_destroy"] = true;
        }
        this.valueHasMutated();
    },

    'destroyAll': function (arrayOfValues) {
        // If you passed zero args, we destroy everything
        if (arrayOfValues === undefined)
            return this['destroy'](function() { return true });

        // If you passed an arg, we interpret it as an array of entries to destroy
        if (!arrayOfValues)
            return [];
        return this['destroy'](function (value) {
            return ko.utils.arrayIndexOf(arrayOfValues, value) >= 0;
        });
    },

    'indexOf': function (item) {
        var underlyingArray = this();
        return ko.utils.arrayIndexOf(underlyingArray, item);
    },

    'replace': function(oldItem, newItem) {
        var index = this['indexOf'](oldItem);
        if (index >= 0) {
            this.valueWillMutate();
            this.peek()[index] = newItem;
            this.valueHasMutated();
        }
    }
};

// Populate ko.observableArray.fn with read/write functions from native arrays
// Important: Do not add any additional functions here that may reasonably be used to *read* data from the array
// because we'll eval them without causing subscriptions, so ko.computed output could end up getting stale
ko.utils.arrayForEach(["pop", "push", "reverse", "shift", "sort", "splice", "unshift"], function (methodName) {
    ko.observableArray['fn'][methodName] = function () {
        // Use "peek" to avoid creating a subscription in any computed that we're executing in the context of
        // (for consistency with mutating regular observables)
        var underlyingArray = this.peek();
        this.valueWillMutate();
        this.cacheDiffForKnownOperation(underlyingArray, methodName, arguments);
        var methodCallResult = underlyingArray[methodName].apply(underlyingArray, arguments);
        this.valueHasMutated();
        return methodCallResult;
    };
});

// Populate ko.observableArray.fn with read-only functions from native arrays
ko.utils.arrayForEach(["slice"], function (methodName) {
    ko.observableArray['fn'][methodName] = function () {
        var underlyingArray = this();
        return underlyingArray[methodName].apply(underlyingArray, arguments);
    };
});

ko.exportSymbol('observableArray', ko.observableArray);
var arrayChangeEventName = 'arrayChange';
ko.extenders['trackArrayChanges'] = function(target) {
    // Only modify the target observable once
    if (target.cacheDiffForKnownOperation) {
        return;
    }
    var trackingChanges = false,
        cachedDiff = null,
        pendingNotifications = 0,
        underlyingSubscribeFunction = target.subscribe;

    // Intercept "subscribe" calls, and for array change events, ensure change tracking is enabled
    target.subscribe = target['subscribe'] = function(callback, callbackTarget, event) {
        if (event === arrayChangeEventName) {
            trackChanges();
        }
        return underlyingSubscribeFunction.apply(this, arguments);
    };

    function trackChanges() {
        // Calling 'trackChanges' multiple times is the same as calling it once
        if (trackingChanges) {
            return;
        }

        trackingChanges = true;

        // Intercept "notifySubscribers" to track how many times it was called.
        var underlyingNotifySubscribersFunction = target['notifySubscribers'];
        target['notifySubscribers'] = function(valueToNotify, event) {
            if (!event || event === defaultEvent) {
                ++pendingNotifications;
            }
            return underlyingNotifySubscribersFunction.apply(this, arguments);
        };

        // Each time the array changes value, capture a clone so that on the next
        // change it's possible to produce a diff
        var previousContents = [].concat(target.peek() || []);
        cachedDiff = null;
        target.subscribe(function(currentContents) {
            // Make a copy of the current contents and ensure it's an array
            currentContents = [].concat(currentContents || []);

            // Compute the diff and issue notifications, but only if someone is listening
            if (target.hasSubscriptionsForEvent(arrayChangeEventName)) {
                var changes = getChanges(previousContents, currentContents);
                if (changes.length) {
                    target['notifySubscribers'](changes, arrayChangeEventName);
                }
            }

            // Eliminate references to the old, removed items, so they can be GCed
            previousContents = currentContents;
            cachedDiff = null;
            pendingNotifications = 0;
        });
    }

    function getChanges(previousContents, currentContents) {
        // We try to re-use cached diffs.
        // The only scenario where pendingNotifications > 1 is when using the KO 'deferred updates' plugin,
        // which without this check would not be compatible with arrayChange notifications. Without that
        // plugin, notifications are always issued immediately so we wouldn't be queueing up more than one.
        if (!cachedDiff || pendingNotifications > 1) {
            cachedDiff = ko.utils.compareArrays(previousContents, currentContents, { 'sparse': true });
        }

        return cachedDiff;
    }

    target.cacheDiffForKnownOperation = function(rawArray, operationName, args) {
        // Only run if we're currently tracking changes for this observable array
        // and there aren't any pending deferred notifications.
        if (!trackingChanges || pendingNotifications) {
            return;
        }
        var diff = [],
            arrayLength = rawArray.length,
            argsLength = args.length,
            offset = 0;

        function pushDiff(status, value, index) {
            diff.push({ 'status': status, 'value': value, 'index': index });
        }
        switch (operationName) {
            case 'push':
                offset = arrayLength;
            case 'unshift':
                for (var index = 0; index < argsLength; index++) {
                    pushDiff('added', args[index], offset + index);
                }
                break;

            case 'pop':
                offset = arrayLength - 1;
            case 'shift':
                if (arrayLength) {
                    pushDiff('deleted', rawArray[offset], offset);
                }
                break;

            case 'splice':
                // Negative start index means 'from end of array'. After that we clamp to [0...arrayLength].
                // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice
                var startIndex = Math.min(Math.max(0, args[0] < 0 ? arrayLength + args[0] : args[0]), arrayLength),
                    endDeleteIndex = argsLength === 1 ? arrayLength : Math.min(startIndex + (args[1] || 0), arrayLength),
                    endAddIndex = startIndex + argsLength - 2,
                    endIndex = Math.max(endDeleteIndex, endAddIndex);
                for (var index = startIndex, argsIndex = 2; index < endIndex; ++index, ++argsIndex) {
                    if (index < endDeleteIndex)
                        pushDiff('deleted', rawArray[index], index);
                    if (index < endAddIndex)
                        pushDiff('added', args[argsIndex], index);
                }
                break;

            default:
                return;
        }
        cachedDiff = diff;
    };
};
ko.dependentObservable = function (evaluatorFunctionOrOptions, evaluatorFunctionTarget, options) {
    var _latestValue,
        _hasBeenEvaluated = false,
        _isBeingEvaluated = false,
        _suppressDisposalUntilDisposeWhenReturnsFalse = false,
        readFunction = evaluatorFunctionOrOptions;

    if (readFunction && typeof readFunction == "object") {
        // Single-parameter syntax - everything is on this "options" param
        options = readFunction;
        readFunction = options["read"];
    } else {
        // Multi-parameter syntax - construct the options according to the params passed
        options = options || {};
        if (!readFunction)
            readFunction = options["read"];
    }
    if (typeof readFunction != "function")
        throw new Error("Pass a function that returns the value of the ko.computed");

    function addSubscriptionToDependency(subscribable) {
        _subscriptionsToDependencies.push(subscribable.subscribe(evaluatePossiblyAsync));
    }

    function disposeAllSubscriptionsToDependencies() {
        ko.utils.arrayForEach(_subscriptionsToDependencies, function (subscription) {
            subscription.dispose();
        });
        _subscriptionsToDependencies = [];
    }

    function evaluatePossiblyAsync() {
        var throttleEvaluationTimeout = dependentObservable['throttleEvaluation'];
        if (throttleEvaluationTimeout && throttleEvaluationTimeout >= 0) {
            clearTimeout(evaluationTimeoutInstance);
            evaluationTimeoutInstance = setTimeout(evaluateImmediate, throttleEvaluationTimeout);
        } else
            evaluateImmediate();
    }

    function evaluateImmediate() {
        if (_isBeingEvaluated) {
            // If the evaluation of a ko.computed causes side effects, it's possible that it will trigger its own re-evaluation.
            // This is not desirable (it's hard for a developer to realise a chain of dependencies might cause this, and they almost
            // certainly didn't intend infinite re-evaluations). So, for predictability, we simply prevent ko.computeds from causing
            // their own re-evaluation. Further discussion at https://github.com/SteveSanderson/knockout/pull/387
            return;
        }

        if (disposeWhen && disposeWhen()) {
            // See comment below about _suppressDisposalUntilDisposeWhenReturnsFalse
            if (!_suppressDisposalUntilDisposeWhenReturnsFalse) {
                dispose();
                _hasBeenEvaluated = true;
                return;
            }
        } else {
            // It just did return false, so we can stop suppressing now
            _suppressDisposalUntilDisposeWhenReturnsFalse = false;
        }

        _isBeingEvaluated = true;
        try {
            // Initially, we assume that none of the subscriptions are still being used (i.e., all are candidates for disposal).
            // Then, during evaluation, we cross off any that are in fact still being used.
            var disposalCandidates = ko.utils.arrayMap(_subscriptionsToDependencies, function(item) {return item.target;});

            ko.dependencyDetection.begin(function(subscribable) {
                var inOld;
                if ((inOld = ko.utils.arrayIndexOf(disposalCandidates, subscribable)) >= 0)
                    disposalCandidates[inOld] = undefined; // Don't want to dispose this subscription, as it's still being used
                else
                    addSubscriptionToDependency(subscribable); // Brand new subscription - add it
            });

            var newValue = evaluatorFunctionTarget ? readFunction.call(evaluatorFunctionTarget) : readFunction();

            // For each subscription no longer being used, remove it from the active subscriptions list and dispose it
            for (var i = disposalCandidates.length - 1; i >= 0; i--) {
                if (disposalCandidates[i])
                    _subscriptionsToDependencies.splice(i, 1)[0].dispose();
            }
            _hasBeenEvaluated = true;

            if (!dependentObservable['equalityComparer'] || !dependentObservable['equalityComparer'](_latestValue, newValue)) {
                dependentObservable["notifySubscribers"](_latestValue, "beforeChange");

                _latestValue = newValue;
                if (DEBUG) dependentObservable._latestValue = _latestValue;
                dependentObservable["notifySubscribers"](_latestValue);
            }
        } finally {
            ko.dependencyDetection.end();
            _isBeingEvaluated = false;
        }

        if (!_subscriptionsToDependencies.length)
            dispose();
    }

    function dependentObservable() {
        if (arguments.length > 0) {
            if (typeof writeFunction === "function") {
                // Writing a value
                writeFunction.apply(evaluatorFunctionTarget, arguments);
            } else {
                throw new Error("Cannot write a value to a ko.computed unless you specify a 'write' option. If you wish to read the current value, don't pass any parameters.");
            }
            return this; // Permits chained assignments
        } else {
            // Reading the value
            if (!_hasBeenEvaluated)
                evaluateImmediate();
            ko.dependencyDetection.registerDependency(dependentObservable);
            return _latestValue;
        }
    }

    function peek() {
        if (!_hasBeenEvaluated)
            evaluateImmediate();
        return _latestValue;
    }

    function isActive() {
        return !_hasBeenEvaluated || _subscriptionsToDependencies.length > 0;
    }

    // By here, "options" is always non-null
    var writeFunction = options["write"],
        disposeWhenNodeIsRemoved = options["disposeWhenNodeIsRemoved"] || options.disposeWhenNodeIsRemoved || null,
        disposeWhenOption = options["disposeWhen"] || options.disposeWhen,
        disposeWhen = disposeWhenOption,
        dispose = disposeAllSubscriptionsToDependencies,
        _subscriptionsToDependencies = [],
        evaluationTimeoutInstance = null;

    if (!evaluatorFunctionTarget)
        evaluatorFunctionTarget = options["owner"];

    dependentObservable.peek = peek;
    dependentObservable.getDependenciesCount = function () { return _subscriptionsToDependencies.length; };
    dependentObservable.hasWriteFunction = typeof options["write"] === "function";
    dependentObservable.dispose = function () { dispose(); };
    dependentObservable.isActive = isActive;

    ko.subscribable.call(dependentObservable);
    ko.utils.extend(dependentObservable, ko.dependentObservable['fn']);

    ko.exportProperty(dependentObservable, 'peek', dependentObservable.peek);
    ko.exportProperty(dependentObservable, 'dispose', dependentObservable.dispose);
    ko.exportProperty(dependentObservable, 'isActive', dependentObservable.isActive);
    ko.exportProperty(dependentObservable, 'getDependenciesCount', dependentObservable.getDependenciesCount);

    // Add a "disposeWhen" callback that, on each evaluation, disposes if the node was removed without using ko.removeNode.
    if (disposeWhenNodeIsRemoved) {
        // Since this computed is associated with a DOM node, and we don't want to dispose the computed
        // until the DOM node is *removed* from the document (as opposed to never having been in the document),
        // we'll prevent disposal until "disposeWhen" first returns false.
        _suppressDisposalUntilDisposeWhenReturnsFalse = true;

        // Only watch for the node's disposal if the value really is a node. It might not be,
        // e.g., { disposeWhenNodeIsRemoved: true } can be used to opt into the "only dispose
        // after first false result" behaviour even if there's no specific node to watch. This
        // technique is intended for KO's internal use only and shouldn't be documented or used
        // by application code, as it's likely to change in a future version of KO.
        if (disposeWhenNodeIsRemoved.nodeType) {
            disposeWhen = function () {
                return !ko.utils.domNodeIsAttachedToDocument(disposeWhenNodeIsRemoved) || (disposeWhenOption && disposeWhenOption());
            };
        }
    }

    // Evaluate, unless deferEvaluation is true
    if (options['deferEvaluation'] !== true)
        evaluateImmediate();

    // Attach a DOM node disposal callback so that the computed will be proactively disposed as soon as the node is
    // removed using ko.removeNode. But skip if isActive is false (there will never be any dependencies to dispose).
    if (disposeWhenNodeIsRemoved && isActive()) {
        dispose = function() {
            ko.utils.domNodeDisposal.removeDisposeCallback(disposeWhenNodeIsRemoved, dispose);
            disposeAllSubscriptionsToDependencies();
        };
        ko.utils.domNodeDisposal.addDisposeCallback(disposeWhenNodeIsRemoved, dispose);
    }

    return dependentObservable;
};

ko.isComputed = function(instance) {
    return ko.hasPrototype(instance, ko.dependentObservable);
};

var protoProp = ko.observable.protoProperty; // == "__ko_proto__"
ko.dependentObservable[protoProp] = ko.observable;

ko.dependentObservable['fn'] = {
    "equalityComparer": valuesArePrimitiveAndEqual
};
ko.dependentObservable['fn'][protoProp] = ko.dependentObservable;

ko.exportSymbol('dependentObservable', ko.dependentObservable);
ko.exportSymbol('computed', ko.dependentObservable); // Make "ko.computed" an alias for "ko.dependentObservable"
ko.exportSymbol('isComputed', ko.isComputed);

(function() {
    var maxNestedObservableDepth = 10; // Escape the (unlikely) pathalogical case where an observable's current value is itself (or similar reference cycle)

    ko.toJS = function(rootObject) {
        if (arguments.length == 0)
            throw new Error("When calling ko.toJS, pass the object you want to convert.");

        // We just unwrap everything at every level in the object graph
        return mapJsObjectGraph(rootObject, function(valueToMap) {
            // Loop because an observable's value might in turn be another observable wrapper
            for (var i = 0; ko.isObservable(valueToMap) && (i < maxNestedObservableDepth); i++)
                valueToMap = valueToMap();
            return valueToMap;
        });
    };

    ko.toJSON = function(rootObject, replacer, space) {     // replacer and space are optional
        var plainJavaScriptObject = ko.toJS(rootObject);
        return ko.utils.stringifyJson(plainJavaScriptObject, replacer, space);
    };

    function mapJsObjectGraph(rootObject, mapInputCallback, visitedObjects) {
        visitedObjects = visitedObjects || new objectLookup();

        rootObject = mapInputCallback(rootObject);
        var canHaveProperties = (typeof rootObject == "object") && (rootObject !== null) && (rootObject !== undefined) && (!(rootObject instanceof Date)) && (!(rootObject instanceof String)) && (!(rootObject instanceof Number)) && (!(rootObject instanceof Boolean));
        if (!canHaveProperties)
            return rootObject;

        var outputProperties = rootObject instanceof Array ? [] : {};
        visitedObjects.save(rootObject, outputProperties);

        visitPropertiesOrArrayEntries(rootObject, function(indexer) {
            var propertyValue = mapInputCallback(rootObject[indexer]);

            switch (typeof propertyValue) {
                case "boolean":
                case "number":
                case "string":
                case "function":
                    outputProperties[indexer] = propertyValue;
                    break;
                case "object":
                case "undefined":
                    var previouslyMappedValue = visitedObjects.get(propertyValue);
                    outputProperties[indexer] = (previouslyMappedValue !== undefined)
                        ? previouslyMappedValue
                        : mapJsObjectGraph(propertyValue, mapInputCallback, visitedObjects);
                    break;
            }
        });

        return outputProperties;
    }

    function visitPropertiesOrArrayEntries(rootObject, visitorCallback) {
        if (rootObject instanceof Array) {
            for (var i = 0; i < rootObject.length; i++)
                visitorCallback(i);

            // For arrays, also respect toJSON property for custom mappings (fixes #278)
            if (typeof rootObject['toJSON'] == 'function')
                visitorCallback('toJSON');
        } else {
            for (var propertyName in rootObject) {
                visitorCallback(propertyName);
            }
        }
    };

    function objectLookup() {
        this.keys = [];
        this.values = [];
    };

    objectLookup.prototype = {
        constructor: objectLookup,
        save: function(key, value) {
            var existingIndex = ko.utils.arrayIndexOf(this.keys, key);
            if (existingIndex >= 0)
                this.values[existingIndex] = value;
            else {
                this.keys.push(key);
                this.values.push(value);
            }
        },
        get: function(key) {
            var existingIndex = ko.utils.arrayIndexOf(this.keys, key);
            return (existingIndex >= 0) ? this.values[existingIndex] : undefined;
        }
    };
})();

ko.exportSymbol('toJS', ko.toJS);
ko.exportSymbol('toJSON', ko.toJSON);
(function () {
    var hasDomDataExpandoProperty = '__ko__hasDomDataOptionValue__';

    // Normally, SELECT elements and their OPTIONs can only take value of type 'string' (because the values
    // are stored on DOM attributes). ko.selectExtensions provides a way for SELECTs/OPTIONs to have values
    // that are arbitrary objects. This is very convenient when implementing things like cascading dropdowns.
    ko.selectExtensions = {
        readValue : function(element) {
            switch (ko.utils.tagNameLower(element)) {
                case 'option':
                    if (element[hasDomDataExpandoProperty] === true)
                        return ko.utils.domData.get(element, ko.bindingHandlers.options.optionValueDomDataKey);
                    return ko.utils.ieVersion <= 7
                        ? (element.getAttributeNode('value') && element.getAttributeNode('value').specified ? element.value : element.text)
                        : element.value;
                case 'select':
                    return element.selectedIndex >= 0 ? ko.selectExtensions.readValue(element.options[element.selectedIndex]) : undefined;
                default:
                    return element.value;
            }
        },

        writeValue: function(element, value) {
            switch (ko.utils.tagNameLower(element)) {
                case 'option':
                    switch(typeof value) {
                        case "string":
                            ko.utils.domData.set(element, ko.bindingHandlers.options.optionValueDomDataKey, undefined);
                            if (hasDomDataExpandoProperty in element) { // IE <= 8 throws errors if you delete non-existent properties from a DOM node
                                delete element[hasDomDataExpandoProperty];
                            }
                            element.value = value;
                            break;
                        default:
                            // Store arbitrary object using DomData
                            ko.utils.domData.set(element, ko.bindingHandlers.options.optionValueDomDataKey, value);
                            element[hasDomDataExpandoProperty] = true;

                            // Special treatment of numbers is just for backward compatibility. KO 1.2.1 wrote numerical values to element.value.
                            element.value = typeof value === "number" ? value : "";
                            break;
                    }
                    break;
                case 'select':
                    if (value === "")
                        value = undefined;
                    if (value === null || value === undefined)
                        element.selectedIndex = -1;
                    for (var i = element.options.length - 1; i >= 0; i--) {
                        if (ko.selectExtensions.readValue(element.options[i]) == value) {
                            element.selectedIndex = i;
                            break;
                        }
                    }
                    // for drop-down select, ensure first is selected
                    if (!(element.size > 1) && element.selectedIndex === -1) {
                        element.selectedIndex = 0;
                    }
                    break;
                default:
                    if ((value === null) || (value === undefined))
                        value = "";
                    element.value = value;
                    break;
            }
        }
    };
})();

ko.exportSymbol('selectExtensions', ko.selectExtensions);
ko.exportSymbol('selectExtensions.readValue', ko.selectExtensions.readValue);
ko.exportSymbol('selectExtensions.writeValue', ko.selectExtensions.writeValue);
ko.expressionRewriting = (function () {
    var javaScriptReservedWords = ["true", "false", "null", "undefined"];

    // Matches something that can be assigned to--either an isolated identifier or something ending with a property accessor
    // This is designed to be simple and avoid false negatives, but could produce false positives (e.g., a+b.c).
    // This also will not properly handle nested brackets (e.g., obj1[obj2['prop']]; see #911).
    var javaScriptAssignmentTarget = /^(?:[$_a-z][$\w]*|(.+)(\.\s*[$_a-z][$\w]*|\[.+\]))$/i;

    function getWriteableValue(expression) {
        if (ko.utils.arrayIndexOf(javaScriptReservedWords, expression) >= 0)
            return false;
        var match = expression.match(javaScriptAssignmentTarget);
        return match === null ? false : match[1] ? ('Object(' + match[1] + ')' + match[2]) : expression;
    }

    // The following regular expressions will be used to split an object-literal string into tokens

        // These two match strings, either with double quotes or single quotes
    var stringDouble = '"(?:[^"\\\\]|\\\\.)*"',
        stringSingle = "'(?:[^'\\\\]|\\\\.)*'",
        // Matches a regular expression (text enclosed by slashes), but will also match sets of divisions
        // as a regular expression (this is handled by the parsing loop below).
        stringRegexp = '/(?:[^/\\\\]|\\\\.)*/\w*',
        // These characters have special meaning to the parser and must not appear in the middle of a
        // token, except as part of a string.
        specials = ',"\'{}()/:[\\]',
        // Match text (at least two characters) that does not contain any of the above special characters,
        // although some of the special characters are allowed to start it (all but the colon and comma).
        // The text can contain spaces, but leading or trailing spaces are skipped.
        everyThingElse = '[^\\s:,/][^' + specials + ']*[^\\s' + specials + ']',
        // Match any non-space character not matched already. This will match colons and commas, since they're
        // not matched by "everyThingElse", but will also match any other single character that wasn't already
        // matched (for example: in "a: 1, b: 2", each of the non-space characters will be matched by oneNotSpace).
        oneNotSpace = '[^\\s]',

        // Create the actual regular expression by or-ing the above strings. The order is important.
        bindingToken = RegExp(stringDouble + '|' + stringSingle + '|' + stringRegexp + '|' + everyThingElse + '|' + oneNotSpace, 'g'),

        // Match end of previous token to determine whether a slash is a division or regex.
        divisionLookBehind = /[\])"'A-Za-z0-9_$]+$/,
        keywordRegexLookBehind = {'in':1,'return':1,'typeof':1};

    function parseObjectLiteral(objectLiteralString) {
        // Trim leading and trailing spaces from the string
        var str = ko.utils.stringTrim(objectLiteralString);

        // Trim braces '{' surrounding the whole object literal
        if (str.charCodeAt(0) === 123) str = str.slice(1, -1);

        // Split into tokens
        var result = [], toks = str.match(bindingToken), key, values, depth = 0;

        if (toks) {
            // Append a comma so that we don't need a separate code block to deal with the last item
            toks.push(',');

            for (var i = 0, tok; tok = toks[i]; ++i) {
                var c = tok.charCodeAt(0);
                // A comma signals the end of a key/value pair if depth is zero
                if (c === 44) { // ","
                    if (depth <= 0) {
                        if (key)
                            result.push(values ? {key: key, value: values.join('')} : {'unknown': key});
                        key = values = depth = 0;
                        continue;
                    }
                // Simply skip the colon that separates the name and value
                } else if (c === 58) { // ":"
                    if (!values)
                        continue;
                // A set of slashes is initially matched as a regular expression, but could be division
                } else if (c === 47 && i && tok.length > 1) {  // "/"
                    // Look at the end of the previous token to determine if the slash is actually division
                    var match = toks[i-1].match(divisionLookBehind);
                    if (match && !keywordRegexLookBehind[match[0]]) {
                        // The slash is actually a division punctuator; re-parse the remainder of the string (not including the slash)
                        str = str.substr(str.indexOf(tok) + 1);
                        toks = str.match(bindingToken);
                        toks.push(',');
                        i = -1;
                        // Continue with just the slash
                        tok = '/';
                    }
                // Increment depth for parentheses, braces, and brackets so that interior commas are ignored
                } else if (c === 40 || c === 123 || c === 91) { // '(', '{', '['
                    ++depth;
                } else if (c === 41 || c === 125 || c === 93) { // ')', '}', ']'
                    --depth;
                // The key must be a single token; if it's a string, trim the quotes
                } else if (!key && !values) {
                    key = (c === 34 || c === 39) /* '"', "'" */ ? tok.slice(1, -1) : tok;
                    continue;
                }
                if (values)
                    values.push(tok);
                else
                    values = [tok];
            }
        }
        return result;
    }

    // Two-way bindings include a write function that allow the handler to update the value even if it's not an observable.
    var twoWayBindings = {};

    function preProcessBindings(bindingsStringOrKeyValueArray, bindingOptions) {
        bindingOptions = bindingOptions || {};

        function processKeyValue(key, val) {
            var writableVal;
            function callPreprocessHook(obj) {
                return (obj && obj['preprocess']) ? (val = obj['preprocess'](val, key, processKeyValue)) : true;
            }
            if (!callPreprocessHook(ko['getBindingHandler'](key)))
                return;

            if (twoWayBindings[key] && (writableVal = getWriteableValue(val))) {
                // For two-way bindings, provide a write method in case the value
                // isn't a writable observable.
                propertyAccessorResultStrings.push("'" + key + "':function(_z){" + writableVal + "=_z}");
            }

            // Values are wrapped in a function so that each value can be accessed independently
            if (makeValueAccessors) {
                val = 'function(){return ' + val + ' }';
            }
            resultStrings.push("'" + key + "':" + val);
        }

        var resultStrings = [],
            propertyAccessorResultStrings = [],
            makeValueAccessors = bindingOptions['valueAccessors'],
            keyValueArray = typeof bindingsStringOrKeyValueArray === "string" ?
                parseObjectLiteral(bindingsStringOrKeyValueArray) : bindingsStringOrKeyValueArray;

        ko.utils.arrayForEach(keyValueArray, function(keyValue) {
            processKeyValue(keyValue.key || keyValue['unknown'], keyValue.value);
        });

        if (propertyAccessorResultStrings.length)
            processKeyValue('_ko_property_writers', "{" + propertyAccessorResultStrings.join(",") + "}");

        return resultStrings.join(",");
    }

    return {
        bindingRewriteValidators: [],

        twoWayBindings: twoWayBindings,

        parseObjectLiteral: parseObjectLiteral,

        preProcessBindings: preProcessBindings,

        keyValueArrayContainsKey: function(keyValueArray, key) {
            for (var i = 0; i < keyValueArray.length; i++)
                if (keyValueArray[i]['key'] == key)
                    return true;
            return false;
        },

        // Internal, private KO utility for updating model properties from within bindings
        // property:            If the property being updated is (or might be) an observable, pass it here
        //                      If it turns out to be a writable observable, it will be written to directly
        // allBindings:         An object with a get method to retrieve bindings in the current execution context.
        //                      This will be searched for a '_ko_property_writers' property in case you're writing to a non-observable
        // key:                 The key identifying the property to be written. Example: for { hasFocus: myValue }, write to 'myValue' by specifying the key 'hasFocus'
        // value:               The value to be written
        // checkIfDifferent:    If true, and if the property being written is a writable observable, the value will only be written if
        //                      it is !== existing value on that writable observable
        writeValueToProperty: function(property, allBindings, key, value, checkIfDifferent) {
            if (!property || !ko.isObservable(property)) {
                var propWriters = allBindings.get('_ko_property_writers');
                if (propWriters && propWriters[key])
                    propWriters[key](value);
            } else if (ko.isWriteableObservable(property) && (!checkIfDifferent || property.peek() !== value)) {
                property(value);
            }
        }
    };
})();

ko.exportSymbol('expressionRewriting', ko.expressionRewriting);
ko.exportSymbol('expressionRewriting.bindingRewriteValidators', ko.expressionRewriting.bindingRewriteValidators);
ko.exportSymbol('expressionRewriting.parseObjectLiteral', ko.expressionRewriting.parseObjectLiteral);
ko.exportSymbol('expressionRewriting.preProcessBindings', ko.expressionRewriting.preProcessBindings);

// Making bindings explicitly declare themselves as "two way" isn't ideal in the long term (it would be better if
// all bindings could use an official 'property writer' API without needing to declare that they might). However,
// since this is not, and has never been, a public API (_ko_property_writers was never documented), it's acceptable
// as an internal implementation detail in the short term.
// For those developers who rely on _ko_property_writers in their custom bindings, we expose _twoWayBindings as an
// undocumented feature that makes it relatively easy to upgrade to KO 3.0. However, this is still not an official
// public API, and we reserve the right to remove it at any time if we create a real public property writers API.
ko.exportSymbol('expressionRewriting._twoWayBindings', ko.expressionRewriting.twoWayBindings);

// For backward compatibility, define the following aliases. (Previously, these function names were misleading because
// they referred to JSON specifically, even though they actually work with arbitrary JavaScript object literal expressions.)
ko.exportSymbol('jsonExpressionRewriting', ko.expressionRewriting);
ko.exportSymbol('jsonExpressionRewriting.insertPropertyAccessorsIntoJson', ko.expressionRewriting.preProcessBindings);
(function() {
    // "Virtual elements" is an abstraction on top of the usual DOM API which understands the notion that comment nodes
    // may be used to represent hierarchy (in addition to the DOM's natural hierarchy).
    // If you call the DOM-manipulating functions on ko.virtualElements, you will be able to read and write the state
    // of that virtual hierarchy
    //
    // The point of all this is to support containerless templates (e.g., <!-- ko foreach:someCollection -->blah<!-- /ko -->)
    // without having to scatter special cases all over the binding and templating code.

    // IE 9 cannot reliably read the "nodeValue" property of a comment node (see https://github.com/SteveSanderson/knockout/issues/186)
    // but it does give them a nonstandard alternative property called "text" that it can read reliably. Other browsers don't have that property.
    // So, use node.text where available, and node.nodeValue elsewhere
    var commentNodesHaveTextProperty = document && document.createComment("test").text === "<!--test-->";

    var startCommentRegex = commentNodesHaveTextProperty ? /^<!--\s*ko(?:\s+([\s\S]+))?\s*-->$/ : /^\s*ko(?:\s+([\s\S]+))?\s*$/;
    var endCommentRegex =   commentNodesHaveTextProperty ? /^<!--\s*\/ko\s*-->$/ : /^\s*\/ko\s*$/;
    var htmlTagsWithOptionallyClosingChildren = { 'ul': true, 'ol': true };

    function isStartComment(node) {
        return (node.nodeType == 8) && startCommentRegex.test(commentNodesHaveTextProperty ? node.text : node.nodeValue);
    }

    function isEndComment(node) {
        return (node.nodeType == 8) && endCommentRegex.test(commentNodesHaveTextProperty ? node.text : node.nodeValue);
    }

    function getVirtualChildren(startComment, allowUnbalanced) {
        var currentNode = startComment;
        var depth = 1;
        var children = [];
        while (currentNode = currentNode.nextSibling) {
            if (isEndComment(currentNode)) {
                depth--;
                if (depth === 0)
                    return children;
            }

            children.push(currentNode);

            if (isStartComment(currentNode))
                depth++;
        }
        if (!allowUnbalanced)
            throw new Error("Cannot find closing comment tag to match: " + startComment.nodeValue);
        return null;
    }

    function getMatchingEndComment(startComment, allowUnbalanced) {
        var allVirtualChildren = getVirtualChildren(startComment, allowUnbalanced);
        if (allVirtualChildren) {
            if (allVirtualChildren.length > 0)
                return allVirtualChildren[allVirtualChildren.length - 1].nextSibling;
            return startComment.nextSibling;
        } else
            return null; // Must have no matching end comment, and allowUnbalanced is true
    }

    function getUnbalancedChildTags(node) {
        // e.g., from <div>OK</div><!-- ko blah --><span>Another</span>, returns: <!-- ko blah --><span>Another</span>
        //       from <div>OK</div><!-- /ko --><!-- /ko -->,             returns: <!-- /ko --><!-- /ko -->
        var childNode = node.firstChild, captureRemaining = null;
        if (childNode) {
            do {
                if (captureRemaining)                   // We already hit an unbalanced node and are now just scooping up all subsequent nodes
                    captureRemaining.push(childNode);
                else if (isStartComment(childNode)) {
                    var matchingEndComment = getMatchingEndComment(childNode, /* allowUnbalanced: */ true);
                    if (matchingEndComment)             // It's a balanced tag, so skip immediately to the end of this virtual set
                        childNode = matchingEndComment;
                    else
                        captureRemaining = [childNode]; // It's unbalanced, so start capturing from this point
                } else if (isEndComment(childNode)) {
                    captureRemaining = [childNode];     // It's unbalanced (if it wasn't, we'd have skipped over it already), so start capturing
                }
            } while (childNode = childNode.nextSibling);
        }
        return captureRemaining;
    }

    ko.virtualElements = {
        allowedBindings: {},

        childNodes: function(node) {
            return isStartComment(node) ? getVirtualChildren(node) : node.childNodes;
        },

        emptyNode: function(node) {
            if (!isStartComment(node))
                ko.utils.emptyDomNode(node);
            else {
                var virtualChildren = ko.virtualElements.childNodes(node);
                for (var i = 0, j = virtualChildren.length; i < j; i++)
                    ko.removeNode(virtualChildren[i]);
            }
        },

        setDomNodeChildren: function(node, childNodes) {
            if (!isStartComment(node))
                ko.utils.setDomNodeChildren(node, childNodes);
            else {
                ko.virtualElements.emptyNode(node);
                var endCommentNode = node.nextSibling; // Must be the next sibling, as we just emptied the children
                for (var i = 0, j = childNodes.length; i < j; i++)
                    endCommentNode.parentNode.insertBefore(childNodes[i], endCommentNode);
            }
        },

        prepend: function(containerNode, nodeToPrepend) {
            if (!isStartComment(containerNode)) {
                if (containerNode.firstChild)
                    containerNode.insertBefore(nodeToPrepend, containerNode.firstChild);
                else
                    containerNode.appendChild(nodeToPrepend);
            } else {
                // Start comments must always have a parent and at least one following sibling (the end comment)
                containerNode.parentNode.insertBefore(nodeToPrepend, containerNode.nextSibling);
            }
        },

        insertAfter: function(containerNode, nodeToInsert, insertAfterNode) {
            if (!insertAfterNode) {
                ko.virtualElements.prepend(containerNode, nodeToInsert);
            } else if (!isStartComment(containerNode)) {
                // Insert after insertion point
                if (insertAfterNode.nextSibling)
                    containerNode.insertBefore(nodeToInsert, insertAfterNode.nextSibling);
                else
                    containerNode.appendChild(nodeToInsert);
            } else {
                // Children of start comments must always have a parent and at least one following sibling (the end comment)
                containerNode.parentNode.insertBefore(nodeToInsert, insertAfterNode.nextSibling);
            }
        },

        firstChild: function(node) {
            if (!isStartComment(node))
                return node.firstChild;
            if (!node.nextSibling || isEndComment(node.nextSibling))
                return null;
            return node.nextSibling;
        },

        nextSibling: function(node) {
            if (isStartComment(node))
                node = getMatchingEndComment(node);
            if (node.nextSibling && isEndComment(node.nextSibling))
                return null;
            return node.nextSibling;
        },

        hasBindingValue: isStartComment,

        virtualNodeBindingValue: function(node) {
            var regexMatch = (commentNodesHaveTextProperty ? node.text : node.nodeValue).match(startCommentRegex);
            return regexMatch ? regexMatch[1] : null;
        },

        normaliseVirtualElementDomStructure: function(elementVerified) {
            // Workaround for https://github.com/SteveSanderson/knockout/issues/155
            // (IE <= 8 or IE 9 quirks mode parses your HTML weirdly, treating closing </li> tags as if they don't exist, thereby moving comment nodes
            // that are direct descendants of <ul> into the preceding <li>)
            if (!htmlTagsWithOptionallyClosingChildren[ko.utils.tagNameLower(elementVerified)])
                return;

            // Scan immediate children to see if they contain unbalanced comment tags. If they do, those comment tags
            // must be intended to appear *after* that child, so move them there.
            var childNode = elementVerified.firstChild;
            if (childNode) {
                do {
                    if (childNode.nodeType === 1) {
                        var unbalancedTags = getUnbalancedChildTags(childNode);
                        if (unbalancedTags) {
                            // Fix up the DOM by moving the unbalanced tags to where they most likely were intended to be placed - *after* the child
                            var nodeToInsertBefore = childNode.nextSibling;
                            for (var i = 0; i < unbalancedTags.length; i++) {
                                if (nodeToInsertBefore)
                                    elementVerified.insertBefore(unbalancedTags[i], nodeToInsertBefore);
                                else
                                    elementVerified.appendChild(unbalancedTags[i]);
                            }
                        }
                    }
                } while (childNode = childNode.nextSibling);
            }
        }
    };
})();
ko.exportSymbol('virtualElements', ko.virtualElements);
ko.exportSymbol('virtualElements.allowedBindings', ko.virtualElements.allowedBindings);
ko.exportSymbol('virtualElements.emptyNode', ko.virtualElements.emptyNode);
//ko.exportSymbol('virtualElements.firstChild', ko.virtualElements.firstChild);     // firstChild is not minified
ko.exportSymbol('virtualElements.insertAfter', ko.virtualElements.insertAfter);
//ko.exportSymbol('virtualElements.nextSibling', ko.virtualElements.nextSibling);   // nextSibling is not minified
ko.exportSymbol('virtualElements.prepend', ko.virtualElements.prepend);
ko.exportSymbol('virtualElements.setDomNodeChildren', ko.virtualElements.setDomNodeChildren);
(function() {
    var defaultBindingAttributeName = "data-bind";

    ko.bindingProvider = function() {
        this.bindingCache = {};
    };

    ko.utils.extend(ko.bindingProvider.prototype, {
        'nodeHasBindings': function(node) {
            switch (node.nodeType) {
                case 1: return node.getAttribute(defaultBindingAttributeName) != null;   // Element
                case 8: return ko.virtualElements.hasBindingValue(node); // Comment node
                default: return false;
            }
        },

        'getBindings': function(node, bindingContext) {
            var bindingsString = this['getBindingsString'](node, bindingContext);
            return bindingsString ? this['parseBindingsString'](bindingsString, bindingContext, node) : null;
        },

        'getBindingAccessors': function(node, bindingContext) {
            var bindingsString = this['getBindingsString'](node, bindingContext);
            return bindingsString ? this['parseBindingsString'](bindingsString, bindingContext, node, {'valueAccessors':true}) : null;
        },

        // The following function is only used internally by this default provider.
        // It's not part of the interface definition for a general binding provider.
        'getBindingsString': function(node, bindingContext) {
            switch (node.nodeType) {
                case 1: return node.getAttribute(defaultBindingAttributeName);   // Element
                case 8: return ko.virtualElements.virtualNodeBindingValue(node); // Comment node
                default: return null;
            }
        },

        // The following function is only used internally by this default provider.
        // It's not part of the interface definition for a general binding provider.
        'parseBindingsString': function(bindingsString, bindingContext, node, options) {
            try {
                var bindingFunction = createBindingsStringEvaluatorViaCache(bindingsString, this.bindingCache, options);
                return bindingFunction(bindingContext, node);
            } catch (ex) {
                ex.message = "Unable to parse bindings.\nBindings value: " + bindingsString + "\nMessage: " + ex.message;
                throw ex;
            }
        }
    });

    ko.bindingProvider['instance'] = new ko.bindingProvider();

    function createBindingsStringEvaluatorViaCache(bindingsString, cache, options) {
        var cacheKey = bindingsString + (options && options['valueAccessors'] || '');
        return cache[cacheKey]
            || (cache[cacheKey] = createBindingsStringEvaluator(bindingsString, options));
    }

    function createBindingsStringEvaluator(bindingsString, options) {
        // Build the source for a function that evaluates "expression"
        // For each scope variable, add an extra level of "with" nesting
        // Example result: with(sc1) { with(sc0) { return (expression) } }
        var rewrittenBindings = ko.expressionRewriting.preProcessBindings(bindingsString, options),
            functionBody = "with($context){with($data||{}){return{" + rewrittenBindings + "}}}";
        return new Function("$context", "$element", functionBody);
    }
})();

ko.exportSymbol('bindingProvider', ko.bindingProvider);
(function () {
    ko.bindingHandlers = {};

    // The following element types will not be recursed into during binding. In the future, we
    // may consider adding <template> to this list, because such elements' contents are always
    // intended to be bound in a different context from where they appear in the document.
    var bindingDoesNotRecurseIntoElementTypes = {
        // Don't want bindings that operate on text nodes to mutate <script> contents,
        // because it's unexpected and a potential XSS issue
        'script': true
    };

    // Use an overridable method for retrieving binding handlers so that a plugins may support dynamically created handlers
    ko['getBindingHandler'] = function(bindingKey) {
        return ko.bindingHandlers[bindingKey];
    };

    // The ko.bindingContext constructor is only called directly to create the root context. For child
    // contexts, use bindingContext.createChildContext or bindingContext.extend.
    ko.bindingContext = function(dataItemOrAccessor, parentContext, dataItemAlias, extendCallback) {

        // The binding context object includes static properties for the current, parent, and root view models.
        // If a view model is actually stored in an observable, the corresponding binding context object, and
        // any child contexts, must be updated when the view model is changed.
        function updateContext() {
            // Most of the time, the context will directly get a view model object, but if a function is given,
            // we call the function to retrieve the view model. If the function accesses any obsevables (or is
            // itself an observable), the dependency is tracked, and those observables can later cause the binding
            // context to be updated.
            var dataItem = isFunc ? dataItemOrAccessor() : dataItemOrAccessor;

            if (parentContext) {
                // When a "parent" context is given, register a dependency on the parent context. Thus whenever the
                // parent context is updated, this context will also be updated.
                if (parentContext._subscribable)
                    parentContext._subscribable();

                // Copy $root and any custom properties from the parent context
                ko.utils.extend(self, parentContext);

                // Because the above copy overwrites our own properties, we need to reset them.
                // During the first execution, "subscribable" isn't set, so don't bother doing the update then.
                if (subscribable) {
                    self._subscribable = subscribable;
                }
            } else {
                self['$parents'] = [];
                self['$root'] = dataItem;

                // Export 'ko' in the binding context so it will be available in bindings and templates
                // even if 'ko' isn't exported as a global, such as when using an AMD loader.
                // See https://github.com/SteveSanderson/knockout/issues/490
                self['ko'] = ko;
            }
            self['$rawData'] = dataItemOrAccessor;
            self['$data'] = dataItem;
            if (dataItemAlias)
                self[dataItemAlias] = dataItem;

            // The extendCallback function is provided when creating a child context or extending a context.
            // It handles the specific actions needed to finish setting up the binding context. Actions in this
            // function could also add dependencies to this binding context.
            if (extendCallback)
                extendCallback(self, parentContext, dataItem);

            return self['$data'];
        }
        function disposeWhen() {
            return nodes && !ko.utils.anyDomNodeIsAttachedToDocument(nodes);
        }

        var self = this,
            isFunc = typeof(dataItemOrAccessor) == "function",
            nodes,
            subscribable = ko.dependentObservable(updateContext, null, { disposeWhen: disposeWhen, disposeWhenNodeIsRemoved: true });

        // At this point, the binding context has been initialized, and the "subscribable" computed observable is
        // subscribed to any observables that were accessed in the process. If there is nothing to track, the
        // computed will be inactive, and we can safely throw it away. If it's active, the computed is stored in
        // the context object.
        if (subscribable.isActive()) {
            self._subscribable = subscribable;

            // Always notify because even if the model ($data) hasn't changed, other context properties might have changed
            subscribable['equalityComparer'] = null;

            // We need to be able to dispose of this computed observable when it's no longer needed. This would be
            // easy if we had a single node to watch, but binding contexts can be used by many different nodes, and
            // we cannot assume that those nodes have any relation to each other. So instead we track any node that
            // the context is attached to, and dispose the computed when all of those nodes have been cleaned.

            // Add properties to *subscribable* instead of *self* because any properties added to *self* may be overwritten on updates
            nodes = [];
            subscribable._addNode = function(node) {
                nodes.push(node);
                ko.utils.domNodeDisposal.addDisposeCallback(node, function(node) {
                    ko.utils.arrayRemoveItem(nodes, node);
                    if (!nodes.length) {
                        subscribable.dispose();
                        self._subscribable = subscribable = undefined;
                    }
                });
            };
        }
    }

    // Extend the binding context hierarchy with a new view model object. If the parent context is watching
    // any obsevables, the new child context will automatically get a dependency on the parent context.
    // But this does not mean that the $data value of the child context will also get updated. If the child
    // view model also depends on the parent view model, you must provide a function that returns the correct
    // view model on each update.
    ko.bindingContext.prototype['createChildContext'] = function (dataItemOrAccessor, dataItemAlias, extendCallback) {
        return new ko.bindingContext(dataItemOrAccessor, this, dataItemAlias, function(self, parentContext) {
            // Extend the context hierarchy by setting the appropriate pointers
            self['$parentContext'] = parentContext;
            self['$parent'] = parentContext['$data'];
            self['$parents'] = (parentContext['$parents'] || []).slice(0);
            self['$parents'].unshift(self['$parent']);
            if (extendCallback)
                extendCallback(self);
        });
    };

    // Extend the binding context with new custom properties. This doesn't change the context hierarchy.
    // Similarly to "child" contexts, provide a function here to make sure that the correct values are set
    // when an observable view model is updated.
    ko.bindingContext.prototype['extend'] = function(properties) {
        return new ko.bindingContext(this['$rawData'], this, null, function(self) {
            ko.utils.extend(self, typeof(properties) == "function" ? properties() : properties);
        });
    };

    // Returns the valueAccesor function for a binding value
    function makeValueAccessor(value) {
        return function() {
            return value;
        };
    }

    // Returns the value of a valueAccessor function
    function evaluateValueAccessor(valueAccessor) {
        return valueAccessor();
    }

    // Given a function that returns bindings, create and return a new object that contains
    // binding value-accessors functions. Each accessor function calls the original function
    // so that it always gets the latest value and all dependencies are captured. This is used
    // by ko.applyBindingsToNode and getBindingsAndMakeAccessors.
    function makeAccessorsFromFunction(callback) {
        return ko.utils.objectMap(ko.dependencyDetection.ignore(callback), function(value, key) {
            return function() {
                return callback()[key];
            };
        });
    }

    // Given a bindings function or object, create and return a new object that contains
    // binding value-accessors functions. This is used by ko.applyBindingsToNode.
    function makeBindingAccessors(bindings, context, node) {
        if (typeof bindings === 'function') {
            return makeAccessorsFromFunction(bindings.bind(null, context, node));
        } else {
            return ko.utils.objectMap(bindings, makeValueAccessor);
        }
    }

    // This function is used if the binding provider doesn't include a getBindingAccessors function.
    // It must be called with 'this' set to the provider instance.
    function getBindingsAndMakeAccessors(node, context) {
        return makeAccessorsFromFunction(this['getBindings'].bind(this, node, context));
    }

    function validateThatBindingIsAllowedForVirtualElements(bindingName) {
        var validator = ko.virtualElements.allowedBindings[bindingName];
        if (!validator)
            throw new Error("The binding '" + bindingName + "' cannot be used with virtual elements")
    }

    function applyBindingsToDescendantsInternal (bindingContext, elementOrVirtualElement, bindingContextsMayDifferFromDomParentElement) {
        var currentChild,
            nextInQueue = ko.virtualElements.firstChild(elementOrVirtualElement),
            provider = ko.bindingProvider['instance'],
            preprocessNode = provider['preprocessNode'];

        // Preprocessing allows a binding provider to mutate a node before bindings are applied to it. For example it's
        // possible to insert new siblings after it, and/or replace the node with a different one. This can be used to
        // implement custom binding syntaxes, such as {{ value }} for string interpolation, or custom element types that
        // trigger insertion of <template> contents at that point in the document.
        if (preprocessNode) {
            while (currentChild = nextInQueue) {
                nextInQueue = ko.virtualElements.nextSibling(currentChild);
                preprocessNode.call(provider, currentChild);
            }
            // Reset nextInQueue for the next loop
            nextInQueue = ko.virtualElements.firstChild(elementOrVirtualElement);
        }

        while (currentChild = nextInQueue) {
            // Keep a record of the next child *before* applying bindings, in case the binding removes the current child from its position
            nextInQueue = ko.virtualElements.nextSibling(currentChild);
            applyBindingsToNodeAndDescendantsInternal(bindingContext, currentChild, bindingContextsMayDifferFromDomParentElement);
        }
    }

    function applyBindingsToNodeAndDescendantsInternal (bindingContext, nodeVerified, bindingContextMayDifferFromDomParentElement) {
        var shouldBindDescendants = true;

        // Perf optimisation: Apply bindings only if...
        // (1) We need to store the binding context on this node (because it may differ from the DOM parent node's binding context)
        //     Note that we can't store binding contexts on non-elements (e.g., text nodes), as IE doesn't allow expando properties for those
        // (2) It might have bindings (e.g., it has a data-bind attribute, or it's a marker for a containerless template)
        var isElement = (nodeVerified.nodeType === 1);
        if (isElement) // Workaround IE <= 8 HTML parsing weirdness
            ko.virtualElements.normaliseVirtualElementDomStructure(nodeVerified);

        var shouldApplyBindings = (isElement && bindingContextMayDifferFromDomParentElement)             // Case (1)
                               || ko.bindingProvider['instance']['nodeHasBindings'](nodeVerified);       // Case (2)
        if (shouldApplyBindings)
            shouldBindDescendants = applyBindingsToNodeInternal(nodeVerified, null, bindingContext, bindingContextMayDifferFromDomParentElement)['shouldBindDescendants'];

        if (shouldBindDescendants && !bindingDoesNotRecurseIntoElementTypes[ko.utils.tagNameLower(nodeVerified)]) {
            // We're recursing automatically into (real or virtual) child nodes without changing binding contexts. So,
            //  * For children of a *real* element, the binding context is certainly the same as on their DOM .parentNode,
            //    hence bindingContextsMayDifferFromDomParentElement is false
            //  * For children of a *virtual* element, we can't be sure. Evaluating .parentNode on those children may
            //    skip over any number of intermediate virtual elements, any of which might define a custom binding context,
            //    hence bindingContextsMayDifferFromDomParentElement is true
            applyBindingsToDescendantsInternal(bindingContext, nodeVerified, /* bindingContextsMayDifferFromDomParentElement: */ !isElement);
        }
    }

    var boundElementDomDataKey = ko.utils.domData.nextKey();


    function topologicalSortBindings(bindings) {
        // Depth-first sort
        var result = [],                // The list of key/handler pairs that we will return
            bindingsConsidered = {},    // A temporary record of which bindings are already in 'result'
            cyclicDependencyStack = []; // Keeps track of a depth-search so that, if there's a cycle, we know which bindings caused it
        ko.utils.objectForEach(bindings, function pushBinding(bindingKey) {
            if (!bindingsConsidered[bindingKey]) {
                var binding = ko['getBindingHandler'](bindingKey);
                if (binding) {
                    // First add dependencies (if any) of the current binding
                    if (binding['after']) {
                        cyclicDependencyStack.push(bindingKey);
                        ko.utils.arrayForEach(binding['after'], function(bindingDependencyKey) {
                            if (bindings[bindingDependencyKey]) {
                                if (ko.utils.arrayIndexOf(cyclicDependencyStack, bindingDependencyKey) !== -1) {
                                    throw Error("Cannot combine the following bindings, because they have a cyclic dependency: " + cyclicDependencyStack.join(", "));
                                } else {
                                    pushBinding(bindingDependencyKey);
                                }
                            }
                        });
                        cyclicDependencyStack.pop();
                    }
                    // Next add the current binding
                    result.push({ key: bindingKey, handler: binding });
                }
                bindingsConsidered[bindingKey] = true;
            }
        });

        return result;
    }

    function applyBindingsToNodeInternal(node, sourceBindings, bindingContext, bindingContextMayDifferFromDomParentElement) {
        // Prevent multiple applyBindings calls for the same node, except when a binding value is specified
        var alreadyBound = ko.utils.domData.get(node, boundElementDomDataKey);
        if (!sourceBindings) {
            if (alreadyBound) {
                throw Error("You cannot apply bindings multiple times to the same element.");
            }
            ko.utils.domData.set(node, boundElementDomDataKey, true);
        }

        // Optimization: Don't store the binding context on this node if it's definitely the same as on node.parentNode, because
        // we can easily recover it just by scanning up the node's ancestors in the DOM
        // (note: here, parent node means "real DOM parent" not "virtual parent", as there's no O(1) way to find the virtual parent)
        if (!alreadyBound && bindingContextMayDifferFromDomParentElement)
            ko.storedBindingContextForNode(node, bindingContext);

        // Use bindings if given, otherwise fall back on asking the bindings provider to give us some bindings
        var bindings;
        if (sourceBindings && typeof sourceBindings !== 'function') {
            bindings = sourceBindings;
        } else {
            var provider = ko.bindingProvider['instance'],
                getBindings = provider['getBindingAccessors'] || getBindingsAndMakeAccessors;

            if (sourceBindings || bindingContext._subscribable) {
                // When an obsevable view model is used, the binding context will expose an observable _subscribable value.
                // Get the binding from the provider within a computed observable so that we can update the bindings whenever
                // the binding context is updated.
                var bindingsUpdater = ko.dependentObservable(
                    function() {
                        bindings = sourceBindings ? sourceBindings(bindingContext, node) : getBindings.call(provider, node, bindingContext);
                        // Register a dependency on the binding context
                        if (bindings && bindingContext._subscribable)
                            bindingContext._subscribable();
                        return bindings;
                    },
                    null, { disposeWhenNodeIsRemoved: node }
                );

                if (!bindings || !bindingsUpdater.isActive())
                    bindingsUpdater = null;
            } else {
                bindings = ko.dependencyDetection.ignore(getBindings, provider, [node, bindingContext]);
            }
        }

        var bindingHandlerThatControlsDescendantBindings;
        if (bindings) {
            // Return the value accessor for a given binding. When bindings are static (won't be updated because of a binding
            // context update), just return the value accessor from the binding. Otherwise, return a function that always gets
            // the latest binding value and registers a dependency on the binding updater.
            var getValueAccessor = bindingsUpdater
                ? function(bindingKey) {
                    return function() {
                        return evaluateValueAccessor(bindingsUpdater()[bindingKey]);
                    };
                } : function(bindingKey) {
                    return bindings[bindingKey];
                };

            // Use of allBindings as a function is maintained for backwards compatibility, but its use is deprecated
            function allBindings() {
                return ko.utils.objectMap(bindingsUpdater ? bindingsUpdater() : bindings, evaluateValueAccessor);
            }
            // The following is the 3.x allBindings API
            allBindings['get'] = function(key) {
                return bindings[key] && evaluateValueAccessor(getValueAccessor(key));
            };
            allBindings['has'] = function(key) {
                return key in bindings;
            };

            // First put the bindings into the right order
            var orderedBindings = topologicalSortBindings(bindings);

            // Go through the sorted bindings, calling init and update for each
            ko.utils.arrayForEach(orderedBindings, function(bindingKeyAndHandler) {
                // Note that topologicalSortBindings has already filtered out any nonexistent binding handlers,
                // so bindingKeyAndHandler.handler will always be nonnull.
                var handlerInitFn = bindingKeyAndHandler.handler["init"],
                    handlerUpdateFn = bindingKeyAndHandler.handler["update"],
                    bindingKey = bindingKeyAndHandler.key;

                if (node.nodeType === 8) {
                    validateThatBindingIsAllowedForVirtualElements(bindingKey);
                }

                try {
                    // Run init, ignoring any dependencies
                    if (typeof handlerInitFn == "function") {
                        ko.dependencyDetection.ignore(function() {
                            var initResult = handlerInitFn(node, getValueAccessor(bindingKey), allBindings, bindingContext['$data'], bindingContext);

                            // If this binding handler claims to control descendant bindings, make a note of this
                            if (initResult && initResult['controlsDescendantBindings']) {
                                if (bindingHandlerThatControlsDescendantBindings !== undefined)
                                    throw new Error("Multiple bindings (" + bindingHandlerThatControlsDescendantBindings + " and " + bindingKey + ") are trying to control descendant bindings of the same element. You cannot use these bindings together on the same element.");
                                bindingHandlerThatControlsDescendantBindings = bindingKey;
                            }
                        });
                    }

                    // Run update in its own computed wrapper
                    if (typeof handlerUpdateFn == "function") {
                        ko.dependentObservable(
                            function() {
                                handlerUpdateFn(node, getValueAccessor(bindingKey), allBindings, bindingContext['$data'], bindingContext);
                            },
                            null,
                            { disposeWhenNodeIsRemoved: node }
                        );
                    }
                } catch (ex) {
                    ex.message = "Unable to process binding \"" + bindingKey + ": " + bindings[bindingKey] + "\"\nMessage: " + ex.message;
                    throw ex;
                }
            });
        }

        return {
            'shouldBindDescendants': bindingHandlerThatControlsDescendantBindings === undefined
        };
    };

    var storedBindingContextDomDataKey = ko.utils.domData.nextKey();
    ko.storedBindingContextForNode = function (node, bindingContext) {
        if (arguments.length == 2) {
            ko.utils.domData.set(node, storedBindingContextDomDataKey, bindingContext);
            if (bindingContext._subscribable)
                bindingContext._subscribable._addNode(node);
        } else {
            return ko.utils.domData.get(node, storedBindingContextDomDataKey);
        }
    }

    function getBindingContext(viewModelOrBindingContext) {
        return viewModelOrBindingContext && (viewModelOrBindingContext instanceof ko.bindingContext)
            ? viewModelOrBindingContext
            : new ko.bindingContext(viewModelOrBindingContext);
    }

    ko.applyBindingAccessorsToNode = function (node, bindings, viewModelOrBindingContext) {
        if (node.nodeType === 1) // If it's an element, workaround IE <= 8 HTML parsing weirdness
            ko.virtualElements.normaliseVirtualElementDomStructure(node);
        return applyBindingsToNodeInternal(node, bindings, getBindingContext(viewModelOrBindingContext), true);
    };

    ko.applyBindingsToNode = function (node, bindings, viewModelOrBindingContext) {
        var context = getBindingContext(viewModelOrBindingContext);
        return ko.applyBindingAccessorsToNode(node, makeBindingAccessors(bindings, context, node), context);
    };

    ko.applyBindingsToDescendants = function(viewModelOrBindingContext, rootNode) {
        if (rootNode.nodeType === 1 || rootNode.nodeType === 8)
            applyBindingsToDescendantsInternal(getBindingContext(viewModelOrBindingContext), rootNode, true);
    };

    ko.applyBindings = function (viewModelOrBindingContext, rootNode) {
        if (rootNode && (rootNode.nodeType !== 1) && (rootNode.nodeType !== 8))
            throw new Error("ko.applyBindings: first parameter should be your view model; second parameter should be a DOM node");
        rootNode = rootNode || window.document.body; // Make "rootNode" parameter optional

        applyBindingsToNodeAndDescendantsInternal(getBindingContext(viewModelOrBindingContext), rootNode, true);
    };

    // Retrieving binding context from arbitrary nodes
    ko.contextFor = function(node) {
        // We can only do something meaningful for elements and comment nodes (in particular, not text nodes, as IE can't store domdata for them)
        switch (node.nodeType) {
            case 1:
            case 8:
                var context = ko.storedBindingContextForNode(node);
                if (context) return context;
                if (node.parentNode) return ko.contextFor(node.parentNode);
                break;
        }
        return undefined;
    };
    ko.dataFor = function(node) {
        var context = ko.contextFor(node);
        return context ? context['$data'] : undefined;
    };

    ko.exportSymbol('bindingHandlers', ko.bindingHandlers);
    ko.exportSymbol('applyBindings', ko.applyBindings);
    ko.exportSymbol('applyBindingsToDescendants', ko.applyBindingsToDescendants);
    ko.exportSymbol('applyBindingAccessorsToNode', ko.applyBindingAccessorsToNode);
    ko.exportSymbol('applyBindingsToNode', ko.applyBindingsToNode);
    ko.exportSymbol('contextFor', ko.contextFor);
    ko.exportSymbol('dataFor', ko.dataFor);
})();
var attrHtmlToJavascriptMap = { 'class': 'className', 'for': 'htmlFor' };
ko.bindingHandlers['attr'] = {
    'update': function(element, valueAccessor, allBindings) {
        var value = ko.utils.unwrapObservable(valueAccessor()) || {};
        ko.utils.objectForEach(value, function(attrName, attrValue) {
            attrValue = ko.utils.unwrapObservable(attrValue);

            // To cover cases like "attr: { checked:someProp }", we want to remove the attribute entirely
            // when someProp is a "no value"-like value (strictly null, false, or undefined)
            // (because the absence of the "checked" attr is how to mark an element as not checked, etc.)
            var toRemove = (attrValue === false) || (attrValue === null) || (attrValue === undefined);
            if (toRemove)
                element.removeAttribute(attrName);

            // In IE <= 7 and IE8 Quirks Mode, you have to use the Javascript property name instead of the
            // HTML attribute name for certain attributes. IE8 Standards Mode supports the correct behavior,
            // but instead of figuring out the mode, we'll just set the attribute through the Javascript
            // property for IE <= 8.
            if (ko.utils.ieVersion <= 8 && attrName in attrHtmlToJavascriptMap) {
                attrName = attrHtmlToJavascriptMap[attrName];
                if (toRemove)
                    element.removeAttribute(attrName);
                else
                    element[attrName] = attrValue;
            } else if (!toRemove) {
                element.setAttribute(attrName, attrValue.toString());
            }

            // Treat "name" specially - although you can think of it as an attribute, it also needs
            // special handling on older versions of IE (https://github.com/SteveSanderson/knockout/pull/333)
            // Deliberately being case-sensitive here because XHTML would regard "Name" as a different thing
            // entirely, and there's no strong reason to allow for such casing in HTML.
            if (attrName === "name") {
                ko.utils.setElementName(element, toRemove ? "" : attrValue.toString());
            }
        });
    }
};
(function() {

ko.bindingHandlers['checked'] = {
    'after': ['value', 'attr'],
    'init': function (element, valueAccessor, allBindings) {
        function checkedValue() {
            return allBindings['has']('checkedValue')
                ? ko.utils.unwrapObservable(allBindings.get('checkedValue'))
                : element.value;
        }

        function updateModel() {
            // This updates the model value from the view value.
            // It runs in response to DOM events (click) and changes in checkedValue.
            var isChecked = element.checked,
                elemValue = useCheckedValue ? checkedValue() : isChecked;

            // When we're first setting up this computed, don't change any model state.
            if (!shouldSet) {
                return;
            }

            // We can ignore unchecked radio buttons, because some other radio
            // button will be getting checked, and that one can take care of updating state.
            if (isRadio && !isChecked) {
                return;
            }

            var modelValue = ko.dependencyDetection.ignore(valueAccessor);
            if (isValueArray) {
                if (oldElemValue !== elemValue) {
                    // When we're responding to the checkedValue changing, and the element is
                    // currently checked, replace the old elem value with the new elem value
                    // in the model array.
                    if (isChecked) {
                        ko.utils.addOrRemoveItem(modelValue, elemValue, true);
                        ko.utils.addOrRemoveItem(modelValue, oldElemValue, false);
                    }

                    oldElemValue = elemValue;
                } else {
                    // When we're responding to the user having checked/unchecked a checkbox,
                    // add/remove the element value to the model array.
                    ko.utils.addOrRemoveItem(modelValue, elemValue, isChecked);
                }
            } else {
                ko.expressionRewriting.writeValueToProperty(modelValue, allBindings, 'checked', elemValue, true);
            }
        };

        function updateView() {
            // This updates the view value from the model value.
            // It runs in response to changes in the bound (checked) value.
            var modelValue = ko.utils.unwrapObservable(valueAccessor());

            if (isValueArray) {
                // When a checkbox is bound to an array, being checked represents its value being present in that array
                element.checked = ko.utils.arrayIndexOf(modelValue, checkedValue()) >= 0;
            } else if (isCheckbox) {
                // When a checkbox is bound to any other value (not an array), being checked represents the value being trueish
                element.checked = modelValue;
            } else {
                // For radio buttons, being checked means that the radio button's value corresponds to the model value
                element.checked = (checkedValue() === modelValue);
            }
        };

        var isCheckbox = element.type == "checkbox",
            isRadio = element.type == "radio";

        // Only bind to check boxes and radio buttons
        if (!isCheckbox && !isRadio) {
            return;
        }

        var isValueArray = isCheckbox && (ko.utils.unwrapObservable(valueAccessor()) instanceof Array),
            oldElemValue = isValueArray ? checkedValue() : undefined,
            useCheckedValue = isRadio || isValueArray,
            shouldSet = false;

        // IE 6 won't allow radio buttons to be selected unless they have a name
        if (isRadio && !element.name)
            ko.bindingHandlers['uniqueName']['init'](element, function() { return true });

        // Set up two computeds to update the binding:

        // The first responds to changes in the checkedValue value and to element clicks
        ko.dependentObservable(updateModel, null, { disposeWhenNodeIsRemoved: element });
        ko.utils.registerEventHandler(element, "click", updateModel);

        // The second responds to changes in the model value (the one associated with the checked binding)
        ko.dependentObservable(updateView, null, { disposeWhenNodeIsRemoved: element });

        shouldSet = true;
    }
};
ko.expressionRewriting.twoWayBindings['checked'] = true;

ko.bindingHandlers['checkedValue'] = {
    'update': function (element, valueAccessor) {
        element.value = ko.utils.unwrapObservable(valueAccessor());
    }
};

})();var classesWrittenByBindingKey = '__ko__cssValue';
ko.bindingHandlers['css'] = {
    'update': function (element, valueAccessor) {
        var value = ko.utils.unwrapObservable(valueAccessor());
        if (typeof value == "object") {
            ko.utils.objectForEach(value, function(className, shouldHaveClass) {
                shouldHaveClass = ko.utils.unwrapObservable(shouldHaveClass);
                ko.utils.toggleDomNodeCssClass(element, className, shouldHaveClass);
            });
        } else {
            value = String(value || ''); // Make sure we don't try to store or set a non-string value
            ko.utils.toggleDomNodeCssClass(element, element[classesWrittenByBindingKey], false);
            element[classesWrittenByBindingKey] = value;
            ko.utils.toggleDomNodeCssClass(element, value, true);
        }
    }
};
ko.bindingHandlers['enable'] = {
    'update': function (element, valueAccessor) {
        var value = ko.utils.unwrapObservable(valueAccessor());
        if (value && element.disabled)
            element.removeAttribute("disabled");
        else if ((!value) && (!element.disabled))
            element.disabled = true;
    }
};

ko.bindingHandlers['disable'] = {
    'update': function (element, valueAccessor) {
        ko.bindingHandlers['enable']['update'](element, function() { return !ko.utils.unwrapObservable(valueAccessor()) });
    }
};
// For certain common events (currently just 'click'), allow a simplified data-binding syntax
// e.g. click:handler instead of the usual full-length event:{click:handler}
function makeEventHandlerShortcut(eventName) {
    ko.bindingHandlers[eventName] = {
        'init': function(element, valueAccessor, allBindings, viewModel, bindingContext) {
            var newValueAccessor = function () {
                var result = {};
                result[eventName] = valueAccessor();
                return result;
            };
            return ko.bindingHandlers['event']['init'].call(this, element, newValueAccessor, allBindings, viewModel, bindingContext);
        }
    }
}

ko.bindingHandlers['event'] = {
    'init' : function (element, valueAccessor, allBindings, viewModel, bindingContext) {
        var eventsToHandle = valueAccessor() || {};
        ko.utils.objectForEach(eventsToHandle, function(eventName) {
            if (typeof eventName == "string") {
                ko.utils.registerEventHandler(element, eventName, function (event) {
                    var handlerReturnValue;
                    var handlerFunction = valueAccessor()[eventName];
                    if (!handlerFunction)
                        return;

                    try {
                        // Take all the event args, and prefix with the viewmodel
                        var argsForHandler = ko.utils.makeArray(arguments);
                        viewModel = bindingContext['$data'];
                        argsForHandler.unshift(viewModel);
                        handlerReturnValue = handlerFunction.apply(viewModel, argsForHandler);
                    } finally {
                        if (handlerReturnValue !== true) { // Normally we want to prevent default action. Developer can override this be explicitly returning true.
                            if (event.preventDefault)
                                event.preventDefault();
                            else
                                event.returnValue = false;
                        }
                    }

                    var bubble = allBindings.get(eventName + 'Bubble') !== false;
                    if (!bubble) {
                        event.cancelBubble = true;
                        if (event.stopPropagation)
                            event.stopPropagation();
                    }
                });
            }
        });
    }
};
// "foreach: someExpression" is equivalent to "template: { foreach: someExpression }"
// "foreach: { data: someExpression, afterAdd: myfn }" is equivalent to "template: { foreach: someExpression, afterAdd: myfn }"
ko.bindingHandlers['foreach'] = {
    makeTemplateValueAccessor: function(valueAccessor) {
        return function() {
            var modelValue = valueAccessor(),
                unwrappedValue = ko.utils.peekObservable(modelValue);    // Unwrap without setting a dependency here

            // If unwrappedValue is the array, pass in the wrapped value on its own
            // The value will be unwrapped and tracked within the template binding
            // (See https://github.com/SteveSanderson/knockout/issues/523)
            if ((!unwrappedValue) || typeof unwrappedValue.length == "number")
                return { 'foreach': modelValue, 'templateEngine': ko.nativeTemplateEngine.instance };

            // If unwrappedValue.data is the array, preserve all relevant options and unwrap again value so we get updates
            ko.utils.unwrapObservable(modelValue);
            return {
                'foreach': unwrappedValue['data'],
                'as': unwrappedValue['as'],
                'includeDestroyed': unwrappedValue['includeDestroyed'],
                'afterAdd': unwrappedValue['afterAdd'],
                'beforeRemove': unwrappedValue['beforeRemove'],
                'afterRender': unwrappedValue['afterRender'],
                'beforeMove': unwrappedValue['beforeMove'],
                'afterMove': unwrappedValue['afterMove'],
                'templateEngine': ko.nativeTemplateEngine.instance
            };
        };
    },
    'init': function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        return ko.bindingHandlers['template']['init'](element, ko.bindingHandlers['foreach'].makeTemplateValueAccessor(valueAccessor));
    },
    'update': function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        return ko.bindingHandlers['template']['update'](element, ko.bindingHandlers['foreach'].makeTemplateValueAccessor(valueAccessor), allBindings, viewModel, bindingContext);
    }
};
ko.expressionRewriting.bindingRewriteValidators['foreach'] = false; // Can't rewrite control flow bindings
ko.virtualElements.allowedBindings['foreach'] = true;
var hasfocusUpdatingProperty = '__ko_hasfocusUpdating';
var hasfocusLastValue = '__ko_hasfocusLastValue';
ko.bindingHandlers['hasfocus'] = {
    'init': function(element, valueAccessor, allBindings) {
        var handleElementFocusChange = function(isFocused) {
            // Where possible, ignore which event was raised and determine focus state using activeElement,
            // as this avoids phantom focus/blur events raised when changing tabs in modern browsers.
            // However, not all KO-targeted browsers (Firefox 2) support activeElement. For those browsers,
            // prevent a loss of focus when changing tabs/windows by setting a flag that prevents hasfocus
            // from calling 'blur()' on the element when it loses focus.
            // Discussion at https://github.com/SteveSanderson/knockout/pull/352
            element[hasfocusUpdatingProperty] = true;
            var ownerDoc = element.ownerDocument;
            if ("activeElement" in ownerDoc) {
                var active;
                try {
                    active = ownerDoc.activeElement;
                } catch(e) {
                    // IE9 throws if you access activeElement during page load (see issue #703)
                    active = ownerDoc.body;
                }
                isFocused = (active === element);
            }
            var modelValue = valueAccessor();
            ko.expressionRewriting.writeValueToProperty(modelValue, allBindings, 'hasfocus', isFocused, true);

            //cache the latest value, so we can avoid unnecessarily calling focus/blur in the update function
            element[hasfocusLastValue] = isFocused;
            element[hasfocusUpdatingProperty] = false;
        };
        var handleElementFocusIn = handleElementFocusChange.bind(null, true);
        var handleElementFocusOut = handleElementFocusChange.bind(null, false);

        ko.utils.registerEventHandler(element, "focus", handleElementFocusIn);
        ko.utils.registerEventHandler(element, "focusin", handleElementFocusIn); // For IE
        ko.utils.registerEventHandler(element, "blur",  handleElementFocusOut);
        ko.utils.registerEventHandler(element, "focusout",  handleElementFocusOut); // For IE
    },
    'update': function(element, valueAccessor) {
        var value = !!ko.utils.unwrapObservable(valueAccessor()); //force boolean to compare with last value
        if (!element[hasfocusUpdatingProperty] && element[hasfocusLastValue] !== value) {
            value ? element.focus() : element.blur();
            ko.dependencyDetection.ignore(ko.utils.triggerEvent, null, [element, value ? "focusin" : "focusout"]); // For IE, which doesn't reliably fire "focus" or "blur" events synchronously
        }
    }
};
ko.expressionRewriting.twoWayBindings['hasfocus'] = true;

ko.bindingHandlers['hasFocus'] = ko.bindingHandlers['hasfocus']; // Make "hasFocus" an alias
ko.expressionRewriting.twoWayBindings['hasFocus'] = true;
ko.bindingHandlers['html'] = {
    'init': function() {
        // Prevent binding on the dynamically-injected HTML (as developers are unlikely to expect that, and it has security implications)
        return { 'controlsDescendantBindings': true };
    },
    'update': function (element, valueAccessor) {
        // setHtml will unwrap the value if needed
        ko.utils.setHtml(element, valueAccessor());
    }
};
var withIfDomDataKey = ko.utils.domData.nextKey();
// Makes a binding like with or if
function makeWithIfBinding(bindingKey, isWith, isNot, makeContextCallback) {
    ko.bindingHandlers[bindingKey] = {
        'init': function(element) {
            ko.utils.domData.set(element, withIfDomDataKey, {});
            return { 'controlsDescendantBindings': true };
        },
        'update': function(element, valueAccessor, allBindings, viewModel, bindingContext) {
            var withIfData = ko.utils.domData.get(element, withIfDomDataKey),
                dataValue = ko.utils.unwrapObservable(valueAccessor()),
                shouldDisplay = !isNot !== !dataValue, // equivalent to isNot ? !dataValue : !!dataValue
                isFirstRender = !withIfData.savedNodes,
                needsRefresh = isFirstRender || isWith || (shouldDisplay !== withIfData.didDisplayOnLastUpdate);

            if (needsRefresh) {
                if (isFirstRender) {
                    withIfData.savedNodes = ko.utils.cloneNodes(ko.virtualElements.childNodes(element), true /* shouldCleanNodes */);
                }

                if (shouldDisplay) {
                    if (!isFirstRender) {
                        ko.virtualElements.setDomNodeChildren(element, ko.utils.cloneNodes(withIfData.savedNodes));
                    }
                    ko.applyBindingsToDescendants(makeContextCallback ? makeContextCallback(bindingContext, dataValue) : bindingContext, element);
                } else {
                    ko.virtualElements.emptyNode(element);
                }

                withIfData.didDisplayOnLastUpdate = shouldDisplay;
            }
        }
    };
    ko.expressionRewriting.bindingRewriteValidators[bindingKey] = false; // Can't rewrite control flow bindings
    ko.virtualElements.allowedBindings[bindingKey] = true;
}

// Construct the actual binding handlers
makeWithIfBinding('if');
makeWithIfBinding('ifnot', false /* isWith */, true /* isNot */);
makeWithIfBinding('with', true /* isWith */, false /* isNot */,
    function(bindingContext, dataValue) {
        return bindingContext['createChildContext'](dataValue);
    }
);
ko.bindingHandlers['options'] = {
    'init': function(element) {
        if (ko.utils.tagNameLower(element) !== "select")
            throw new Error("options binding applies only to SELECT elements");

        // Remove all existing <option>s.
        while (element.length > 0) {
            element.remove(0);
        }

        // Ensures that the binding processor doesn't try to bind the options
        return { 'controlsDescendantBindings': true };
    },
    'update': function (element, valueAccessor, allBindings) {
        function selectedOptions() {
            return ko.utils.arrayFilter(element.options, function (node) { return node.selected; });
        }

        var selectWasPreviouslyEmpty = element.length == 0;
        var previousScrollTop = (!selectWasPreviouslyEmpty && element.multiple) ? element.scrollTop : null;

        var unwrappedArray = ko.utils.unwrapObservable(valueAccessor());
        var includeDestroyed = allBindings.get('optionsIncludeDestroyed');
        var captionPlaceholder = {};
        var captionValue;
        var previousSelectedValues;
        if (element.multiple) {
            previousSelectedValues = ko.utils.arrayMap(selectedOptions(), ko.selectExtensions.readValue);
        } else {
            previousSelectedValues = element.selectedIndex >= 0 ? [ ko.selectExtensions.readValue(element.options[element.selectedIndex]) ] : [];
        }

        if (unwrappedArray) {
            if (typeof unwrappedArray.length == "undefined") // Coerce single value into array
                unwrappedArray = [unwrappedArray];

            // Filter out any entries marked as destroyed
            var filteredArray = ko.utils.arrayFilter(unwrappedArray, function(item) {
                return includeDestroyed || item === undefined || item === null || !ko.utils.unwrapObservable(item['_destroy']);
            });

            // If caption is included, add it to the array
            if (allBindings['has']('optionsCaption')) {
                captionValue = ko.utils.unwrapObservable(allBindings.get('optionsCaption'));
                // If caption value is null or undefined, don't show a caption
                if (captionValue !== null && captionValue !== undefined) {
                    filteredArray.unshift(captionPlaceholder);
                }
            }
        } else {
            // If a falsy value is provided (e.g. null), we'll simply empty the select element
            unwrappedArray = [];
        }

        function applyToObject(object, predicate, defaultValue) {
            var predicateType = typeof predicate;
            if (predicateType == "function")    // Given a function; run it against the data value
                return predicate(object);
            else if (predicateType == "string") // Given a string; treat it as a property name on the data value
                return object[predicate];
            else                                // Given no optionsText arg; use the data value itself
                return defaultValue;
        }

        // The following functions can run at two different times:
        // The first is when the whole array is being updated directly from this binding handler.
        // The second is when an observable value for a specific array entry is updated.
        // oldOptions will be empty in the first case, but will be filled with the previously generated option in the second.
        var itemUpdate = false;
        function optionForArrayItem(arrayEntry, index, oldOptions) {
            if (oldOptions.length) {
                previousSelectedValues = oldOptions[0].selected ? [ ko.selectExtensions.readValue(oldOptions[0]) ] : [];
                itemUpdate = true;
            }
            var option = document.createElement("option");
            if (arrayEntry === captionPlaceholder) {
                ko.utils.setTextContent(option, allBindings.get('optionsCaption'));
                ko.selectExtensions.writeValue(option, undefined);
            } else {
                // Apply a value to the option element
                var optionValue = applyToObject(arrayEntry, allBindings.get('optionsValue'), arrayEntry);
                ko.selectExtensions.writeValue(option, ko.utils.unwrapObservable(optionValue));

                // Apply some text to the option element
                var optionText = applyToObject(arrayEntry, allBindings.get('optionsText'), optionValue);
                ko.utils.setTextContent(option, optionText);
            }
            return [option];
        }

        function setSelectionCallback(arrayEntry, newOptions) {
            // IE6 doesn't like us to assign selection to OPTION nodes before they're added to the document.
            // That's why we first added them without selection. Now it's time to set the selection.
            if (previousSelectedValues.length) {
                var isSelected = ko.utils.arrayIndexOf(previousSelectedValues, ko.selectExtensions.readValue(newOptions[0])) >= 0;
                ko.utils.setOptionNodeSelectionState(newOptions[0], isSelected);

                // If this option was changed from being selected during a single-item update, notify the change
                if (itemUpdate && !isSelected)
                    ko.dependencyDetection.ignore(ko.utils.triggerEvent, null, [element, "change"]);
            }
        }

        var callback = setSelectionCallback;
        if (allBindings['has']('optionsAfterRender')) {
            callback = function(arrayEntry, newOptions) {
                setSelectionCallback(arrayEntry, newOptions);
                ko.dependencyDetection.ignore(allBindings.get('optionsAfterRender'), null, [newOptions[0], arrayEntry !== captionPlaceholder ? arrayEntry : undefined]);
            }
        }

        ko.utils.setDomNodeChildrenFromArrayMapping(element, filteredArray, optionForArrayItem, null, callback);

        // Determine if the selection has changed as a result of updating the options list
        var selectionChanged;
        if (element.multiple) {
            // For a multiple-select box, compare the new selection count to the previous one
            // But if nothing was selected before, the selection can't have changed
            selectionChanged = previousSelectedValues.length && selectedOptions().length < previousSelectedValues.length;
        } else {
            // For a single-select box, compare the current value to the previous value
            // But if nothing was selected before or nothing is selected now, just look for a change in selection
            selectionChanged = (previousSelectedValues.length && element.selectedIndex >= 0)
                ? (ko.selectExtensions.readValue(element.options[element.selectedIndex]) !== previousSelectedValues[0])
                : (previousSelectedValues.length || element.selectedIndex >= 0);
        }

        // Ensure consistency between model value and selected option.
        // If the dropdown was changed so that selection is no longer the same,
        // notify the value or selectedOptions binding.
        if (selectionChanged)
            ko.dependencyDetection.ignore(ko.utils.triggerEvent, null, [element, "change"]);

        // Workaround for IE bug
        ko.utils.ensureSelectElementIsRenderedCorrectly(element);

        if (previousScrollTop && Math.abs(previousScrollTop - element.scrollTop) > 20)
            element.scrollTop = previousScrollTop;
    }
};
ko.bindingHandlers['options'].optionValueDomDataKey = ko.utils.domData.nextKey();
ko.bindingHandlers['selectedOptions'] = {
    'after': ['options', 'foreach'],
    'init': function (element, valueAccessor, allBindings) {
        ko.utils.registerEventHandler(element, "change", function () {
            var value = valueAccessor(), valueToWrite = [];
            ko.utils.arrayForEach(element.getElementsByTagName("option"), function(node) {
                if (node.selected)
                    valueToWrite.push(ko.selectExtensions.readValue(node));
            });
            ko.expressionRewriting.writeValueToProperty(value, allBindings, 'selectedOptions', valueToWrite);
        });
    },
    'update': function (element, valueAccessor) {
        if (ko.utils.tagNameLower(element) != "select")
            throw new Error("values binding applies only to SELECT elements");

        var newValue = ko.utils.unwrapObservable(valueAccessor());
        if (newValue && typeof newValue.length == "number") {
            ko.utils.arrayForEach(element.getElementsByTagName("option"), function(node) {
                var isSelected = ko.utils.arrayIndexOf(newValue, ko.selectExtensions.readValue(node)) >= 0;
                ko.utils.setOptionNodeSelectionState(node, isSelected);
            });
        }
    }
};
ko.expressionRewriting.twoWayBindings['selectedOptions'] = true;
ko.bindingHandlers['style'] = {
    'update': function (element, valueAccessor) {
        var value = ko.utils.unwrapObservable(valueAccessor() || {});
        ko.utils.objectForEach(value, function(styleName, styleValue) {
            styleValue = ko.utils.unwrapObservable(styleValue);
            element.style[styleName] = styleValue || ""; // Empty string removes the value, whereas null/undefined have no effect
        });
    }
};
ko.bindingHandlers['submit'] = {
    'init': function (element, valueAccessor, allBindings, viewModel, bindingContext) {
        if (typeof valueAccessor() != "function")
            throw new Error("The value for a submit binding must be a function");
        ko.utils.registerEventHandler(element, "submit", function (event) {
            var handlerReturnValue;
            var value = valueAccessor();
            try { handlerReturnValue = value.call(bindingContext['$data'], element); }
            finally {
                if (handlerReturnValue !== true) { // Normally we want to prevent default action. Developer can override this be explicitly returning true.
                    if (event.preventDefault)
                        event.preventDefault();
                    else
                        event.returnValue = false;
                }
            }
        });
    }
};
ko.bindingHandlers['text'] = {
	'init': function() {
		// Prevent binding on the dynamically-injected text node (as developers are unlikely to expect that, and it has security implications).
		// It should also make things faster, as we no longer have to consider whether the text node might be bindable.
        return { 'controlsDescendantBindings': true };
	},
    'update': function (element, valueAccessor) {
        ko.utils.setTextContent(element, valueAccessor());
    }
};
ko.virtualElements.allowedBindings['text'] = true;
ko.bindingHandlers['uniqueName'] = {
    'init': function (element, valueAccessor) {
        if (valueAccessor()) {
            var name = "ko_unique_" + (++ko.bindingHandlers['uniqueName'].currentIndex);
            ko.utils.setElementName(element, name);
        }
    }
};
ko.bindingHandlers['uniqueName'].currentIndex = 0;
ko.bindingHandlers['value'] = {
    'after': ['options', 'foreach'],
    'init': function (element, valueAccessor, allBindings) {
        // Always catch "change" event; possibly other events too if asked
        var eventsToCatch = ["change"];
        var requestedEventsToCatch = allBindings.get("valueUpdate");
        var propertyChangedFired = false;
        if (requestedEventsToCatch) {
            if (typeof requestedEventsToCatch == "string") // Allow both individual event names, and arrays of event names
                requestedEventsToCatch = [requestedEventsToCatch];
            ko.utils.arrayPushAll(eventsToCatch, requestedEventsToCatch);
            eventsToCatch = ko.utils.arrayGetDistinctValues(eventsToCatch);
        }

        var valueUpdateHandler = function() {
            propertyChangedFired = false;
            var modelValue = valueAccessor();
            var elementValue = ko.selectExtensions.readValue(element);
            ko.expressionRewriting.writeValueToProperty(modelValue, allBindings, 'value', elementValue);
        }

        // Workaround for https://github.com/SteveSanderson/knockout/issues/122
        // IE doesn't fire "change" events on textboxes if the user selects a value from its autocomplete list
        var ieAutoCompleteHackNeeded = ko.utils.ieVersion && element.tagName.toLowerCase() == "input" && element.type == "text"
                                       && element.autocomplete != "off" && (!element.form || element.form.autocomplete != "off");
        if (ieAutoCompleteHackNeeded && ko.utils.arrayIndexOf(eventsToCatch, "propertychange") == -1) {
            ko.utils.registerEventHandler(element, "propertychange", function () { propertyChangedFired = true });
            ko.utils.registerEventHandler(element, "blur", function() {
                if (propertyChangedFired) {
                    valueUpdateHandler();
                }
            });
        }

        ko.utils.arrayForEach(eventsToCatch, function(eventName) {
            // The syntax "after<eventname>" means "run the handler asynchronously after the event"
            // This is useful, for example, to catch "keydown" events after the browser has updated the control
            // (otherwise, ko.selectExtensions.readValue(this) will receive the control's value *before* the key event)
            var handler = valueUpdateHandler;
            if (ko.utils.stringStartsWith(eventName, "after")) {
                handler = function() { setTimeout(valueUpdateHandler, 0) };
                eventName = eventName.substring("after".length);
            }
            ko.utils.registerEventHandler(element, eventName, handler);
        });
    },
    'update': function (element, valueAccessor) {
        var valueIsSelectOption = ko.utils.tagNameLower(element) === "select";
        var newValue = ko.utils.unwrapObservable(valueAccessor());
        var elementValue = ko.selectExtensions.readValue(element);
        var valueHasChanged = (newValue !== elementValue);

        if (valueHasChanged) {
            var applyValueAction = function () { ko.selectExtensions.writeValue(element, newValue); };
            applyValueAction();

            if (valueIsSelectOption) {
                if (newValue !== ko.selectExtensions.readValue(element)) {
                    // If you try to set a model value that can't be represented in an already-populated dropdown, reject that change,
                    // because you're not allowed to have a model value that disagrees with a visible UI selection.
                    ko.dependencyDetection.ignore(ko.utils.triggerEvent, null, [element, "change"]);
                } else {
                    // Workaround for IE6 bug: It won't reliably apply values to SELECT nodes during the same execution thread
                    // right after you've changed the set of OPTION nodes on it. So for that node type, we'll schedule a second thread
                    // to apply the value as well.
                    setTimeout(applyValueAction, 0);
                }
            }
        }
    }
};
ko.expressionRewriting.twoWayBindings['value'] = true;
ko.bindingHandlers['visible'] = {
    'update': function (element, valueAccessor) {
        var value = ko.utils.unwrapObservable(valueAccessor());
        var isCurrentlyVisible = !(element.style.display == "none");
        if (value && !isCurrentlyVisible)
            element.style.display = "";
        else if ((!value) && isCurrentlyVisible)
            element.style.display = "none";
    }
};
// 'click' is just a shorthand for the usual full-length event:{click:handler}
makeEventHandlerShortcut('click');
// If you want to make a custom template engine,
//
// [1] Inherit from this class (like ko.nativeTemplateEngine does)
// [2] Override 'renderTemplateSource', supplying a function with this signature:
//
//        function (templateSource, bindingContext, options) {
//            // - templateSource.text() is the text of the template you should render
//            // - bindingContext.$data is the data you should pass into the template
//            //   - you might also want to make bindingContext.$parent, bindingContext.$parents,
//            //     and bindingContext.$root available in the template too
//            // - options gives you access to any other properties set on "data-bind: { template: options }"
//            //
//            // Return value: an array of DOM nodes
//        }
//
// [3] Override 'createJavaScriptEvaluatorBlock', supplying a function with this signature:
//
//        function (script) {
//            // Return value: Whatever syntax means "Evaluate the JavaScript statement 'script' and output the result"
//            //               For example, the jquery.tmpl template engine converts 'someScript' to '${ someScript }'
//        }
//
//     This is only necessary if you want to allow data-bind attributes to reference arbitrary template variables.
//     If you don't want to allow that, you can set the property 'allowTemplateRewriting' to false (like ko.nativeTemplateEngine does)
//     and then you don't need to override 'createJavaScriptEvaluatorBlock'.

ko.templateEngine = function () { };

ko.templateEngine.prototype['renderTemplateSource'] = function (templateSource, bindingContext, options) {
    throw new Error("Override renderTemplateSource");
};

ko.templateEngine.prototype['createJavaScriptEvaluatorBlock'] = function (script) {
    throw new Error("Override createJavaScriptEvaluatorBlock");
};

ko.templateEngine.prototype['makeTemplateSource'] = function(template, templateDocument) {
    // Named template
    if (typeof template == "string") {
        templateDocument = templateDocument || document;
        var elem = templateDocument.getElementById(template);
        if (!elem)
            throw new Error("Cannot find template with ID " + template);
        return new ko.templateSources.domElement(elem);
    } else if ((template.nodeType == 1) || (template.nodeType == 8)) {
        // Anonymous template
        return new ko.templateSources.anonymousTemplate(template);
    } else
        throw new Error("Unknown template type: " + template);
};

ko.templateEngine.prototype['renderTemplate'] = function (template, bindingContext, options, templateDocument) {
    var templateSource = this['makeTemplateSource'](template, templateDocument);
    return this['renderTemplateSource'](templateSource, bindingContext, options);
};

ko.templateEngine.prototype['isTemplateRewritten'] = function (template, templateDocument) {
    // Skip rewriting if requested
    if (this['allowTemplateRewriting'] === false)
        return true;
    return this['makeTemplateSource'](template, templateDocument)['data']("isRewritten");
};

ko.templateEngine.prototype['rewriteTemplate'] = function (template, rewriterCallback, templateDocument) {
    var templateSource = this['makeTemplateSource'](template, templateDocument);
    var rewritten = rewriterCallback(templateSource['text']());
    templateSource['text'](rewritten);
    templateSource['data']("isRewritten", true);
};

ko.exportSymbol('templateEngine', ko.templateEngine);

ko.templateRewriting = (function () {
    var memoizeDataBindingAttributeSyntaxRegex = /(<([a-z]+\d*)(?:\s+(?!data-bind\s*=\s*)[a-z0-9\-]+(?:=(?:\"[^\"]*\"|\'[^\']*\'))?)*\s+)data-bind\s*=\s*(["'])([\s\S]*?)\3/gi;
    var memoizeVirtualContainerBindingSyntaxRegex = /<!--\s*ko\b\s*([\s\S]*?)\s*-->/g;

    function validateDataBindValuesForRewriting(keyValueArray) {
        var allValidators = ko.expressionRewriting.bindingRewriteValidators;
        for (var i = 0; i < keyValueArray.length; i++) {
            var key = keyValueArray[i]['key'];
            if (allValidators.hasOwnProperty(key)) {
                var validator = allValidators[key];

                if (typeof validator === "function") {
                    var possibleErrorMessage = validator(keyValueArray[i]['value']);
                    if (possibleErrorMessage)
                        throw new Error(possibleErrorMessage);
                } else if (!validator) {
                    throw new Error("This template engine does not support the '" + key + "' binding within its templates");
                }
            }
        }
    }

    function constructMemoizedTagReplacement(dataBindAttributeValue, tagToRetain, nodeName, templateEngine) {
        var dataBindKeyValueArray = ko.expressionRewriting.parseObjectLiteral(dataBindAttributeValue);
        validateDataBindValuesForRewriting(dataBindKeyValueArray);
        var rewrittenDataBindAttributeValue = ko.expressionRewriting.preProcessBindings(dataBindKeyValueArray, {'valueAccessors':true});

        // For no obvious reason, Opera fails to evaluate rewrittenDataBindAttributeValue unless it's wrapped in an additional
        // anonymous function, even though Opera's built-in debugger can evaluate it anyway. No other browser requires this
        // extra indirection.
        var applyBindingsToNextSiblingScript =
            "ko.__tr_ambtns(function($context,$element){return(function(){return{ " + rewrittenDataBindAttributeValue + " } })()},'" + nodeName.toLowerCase() + "')";
        return templateEngine['createJavaScriptEvaluatorBlock'](applyBindingsToNextSiblingScript) + tagToRetain;
    }

    return {
        ensureTemplateIsRewritten: function (template, templateEngine, templateDocument) {
            if (!templateEngine['isTemplateRewritten'](template, templateDocument))
                templateEngine['rewriteTemplate'](template, function (htmlString) {
                    return ko.templateRewriting.memoizeBindingAttributeSyntax(htmlString, templateEngine);
                }, templateDocument);
        },

        memoizeBindingAttributeSyntax: function (htmlString, templateEngine) {
            return htmlString.replace(memoizeDataBindingAttributeSyntaxRegex, function () {
                return constructMemoizedTagReplacement(/* dataBindAttributeValue: */ arguments[4], /* tagToRetain: */ arguments[1], /* nodeName: */ arguments[2], templateEngine);
            }).replace(memoizeVirtualContainerBindingSyntaxRegex, function() {
                return constructMemoizedTagReplacement(/* dataBindAttributeValue: */ arguments[1], /* tagToRetain: */ "<!-- ko -->", /* nodeName: */ "#comment", templateEngine);
            });
        },

        applyMemoizedBindingsToNextSibling: function (bindings, nodeName) {
            return ko.memoization.memoize(function (domNode, bindingContext) {
                var nodeToBind = domNode.nextSibling;
                if (nodeToBind && nodeToBind.nodeName.toLowerCase() === nodeName) {
                    ko.applyBindingAccessorsToNode(nodeToBind, bindings, bindingContext);
                }
            });
        }
    }
})();


// Exported only because it has to be referenced by string lookup from within rewritten template
ko.exportSymbol('__tr_ambtns', ko.templateRewriting.applyMemoizedBindingsToNextSibling);
(function() {
    // A template source represents a read/write way of accessing a template. This is to eliminate the need for template loading/saving
    // logic to be duplicated in every template engine (and means they can all work with anonymous templates, etc.)
    //
    // Two are provided by default:
    //  1. ko.templateSources.domElement       - reads/writes the text content of an arbitrary DOM element
    //  2. ko.templateSources.anonymousElement - uses ko.utils.domData to read/write text *associated* with the DOM element, but
    //                                           without reading/writing the actual element text content, since it will be overwritten
    //                                           with the rendered template output.
    // You can implement your own template source if you want to fetch/store templates somewhere other than in DOM elements.
    // Template sources need to have the following functions:
    //   text() 			- returns the template text from your storage location
    //   text(value)		- writes the supplied template text to your storage location
    //   data(key)			- reads values stored using data(key, value) - see below
    //   data(key, value)	- associates "value" with this template and the key "key". Is used to store information like "isRewritten".
    //
    // Optionally, template sources can also have the following functions:
    //   nodes()            - returns a DOM element containing the nodes of this template, where available
    //   nodes(value)       - writes the given DOM element to your storage location
    // If a DOM element is available for a given template source, template engines are encouraged to use it in preference over text()
    // for improved speed. However, all templateSources must supply text() even if they don't supply nodes().
    //
    // Once you've implemented a templateSource, make your template engine use it by subclassing whatever template engine you were
    // using and overriding "makeTemplateSource" to return an instance of your custom template source.

    ko.templateSources = {};

    // ---- ko.templateSources.domElement -----

    ko.templateSources.domElement = function(element) {
        this.domElement = element;
    }

    ko.templateSources.domElement.prototype['text'] = function(/* valueToWrite */) {
        var tagNameLower = ko.utils.tagNameLower(this.domElement),
            elemContentsProperty = tagNameLower === "script" ? "text"
                                 : tagNameLower === "textarea" ? "value"
                                 : "innerHTML";

        if (arguments.length == 0) {
            return this.domElement[elemContentsProperty];
        } else {
            var valueToWrite = arguments[0];
            if (elemContentsProperty === "innerHTML")
                ko.utils.setHtml(this.domElement, valueToWrite);
            else
                this.domElement[elemContentsProperty] = valueToWrite;
        }
    };

    var dataDomDataPrefix = ko.utils.domData.nextKey() + "_";
    ko.templateSources.domElement.prototype['data'] = function(key /*, valueToWrite */) {
        if (arguments.length === 1) {
            return ko.utils.domData.get(this.domElement, dataDomDataPrefix + key);
        } else {
            ko.utils.domData.set(this.domElement, dataDomDataPrefix + key, arguments[1]);
        }
    };

    // ---- ko.templateSources.anonymousTemplate -----
    // Anonymous templates are normally saved/retrieved as DOM nodes through "nodes".
    // For compatibility, you can also read "text"; it will be serialized from the nodes on demand.
    // Writing to "text" is still supported, but then the template data will not be available as DOM nodes.

    var anonymousTemplatesDomDataKey = ko.utils.domData.nextKey();
    ko.templateSources.anonymousTemplate = function(element) {
        this.domElement = element;
    }
    ko.templateSources.anonymousTemplate.prototype = new ko.templateSources.domElement();
    ko.templateSources.anonymousTemplate.prototype.constructor = ko.templateSources.anonymousTemplate;
    ko.templateSources.anonymousTemplate.prototype['text'] = function(/* valueToWrite */) {
        if (arguments.length == 0) {
            var templateData = ko.utils.domData.get(this.domElement, anonymousTemplatesDomDataKey) || {};
            if (templateData.textData === undefined && templateData.containerData)
                templateData.textData = templateData.containerData.innerHTML;
            return templateData.textData;
        } else {
            var valueToWrite = arguments[0];
            ko.utils.domData.set(this.domElement, anonymousTemplatesDomDataKey, {textData: valueToWrite});
        }
    };
    ko.templateSources.domElement.prototype['nodes'] = function(/* valueToWrite */) {
        if (arguments.length == 0) {
            var templateData = ko.utils.domData.get(this.domElement, anonymousTemplatesDomDataKey) || {};
            return templateData.containerData;
        } else {
            var valueToWrite = arguments[0];
            ko.utils.domData.set(this.domElement, anonymousTemplatesDomDataKey, {containerData: valueToWrite});
        }
    };

    ko.exportSymbol('templateSources', ko.templateSources);
    ko.exportSymbol('templateSources.domElement', ko.templateSources.domElement);
    ko.exportSymbol('templateSources.anonymousTemplate', ko.templateSources.anonymousTemplate);
})();
(function () {
    var _templateEngine;
    ko.setTemplateEngine = function (templateEngine) {
        if ((templateEngine != undefined) && !(templateEngine instanceof ko.templateEngine))
            throw new Error("templateEngine must inherit from ko.templateEngine");
        _templateEngine = templateEngine;
    }

    function invokeForEachNodeInContinuousRange(firstNode, lastNode, action) {
        var node, nextInQueue = firstNode, firstOutOfRangeNode = ko.virtualElements.nextSibling(lastNode);
        while (nextInQueue && ((node = nextInQueue) !== firstOutOfRangeNode)) {
            nextInQueue = ko.virtualElements.nextSibling(node);
            action(node, nextInQueue);
        }
    }

    function activateBindingsOnContinuousNodeArray(continuousNodeArray, bindingContext) {
        // To be used on any nodes that have been rendered by a template and have been inserted into some parent element
        // Walks through continuousNodeArray (which *must* be continuous, i.e., an uninterrupted sequence of sibling nodes, because
        // the algorithm for walking them relies on this), and for each top-level item in the virtual-element sense,
        // (1) Does a regular "applyBindings" to associate bindingContext with this node and to activate any non-memoized bindings
        // (2) Unmemoizes any memos in the DOM subtree (e.g., to activate bindings that had been memoized during template rewriting)

        if (continuousNodeArray.length) {
            var firstNode = continuousNodeArray[0],
                lastNode = continuousNodeArray[continuousNodeArray.length - 1],
                parentNode = firstNode.parentNode,
                provider = ko.bindingProvider['instance'],
                preprocessNode = provider['preprocessNode'];

            if (preprocessNode) {
                invokeForEachNodeInContinuousRange(firstNode, lastNode, function(node, nextNodeInRange) {
                    var nodePreviousSibling = node.previousSibling;
                    var newNodes = preprocessNode.call(provider, node);
                    if (newNodes) {
                        if (node === firstNode)
                            firstNode = newNodes[0] || nextNodeInRange;
                        if (node === lastNode)
                            lastNode = newNodes[newNodes.length - 1] || nodePreviousSibling;
                    }
                });

                // Because preprocessNode can change the nodes, including the first and last nodes, update continuousNodeArray to match.
                // We need the full set, including inner nodes, because the unmemoize step might remove the first node (and so the real
                // first node needs to be in the array).
                continuousNodeArray.length = 0;
                if (!firstNode) { // preprocessNode might have removed all the nodes, in which case there's nothing left to do
                    return;
                }
                if (firstNode === lastNode) {
                    continuousNodeArray.push(firstNode);
                } else {
                    continuousNodeArray.push(firstNode, lastNode);
                    ko.utils.fixUpContinuousNodeArray(continuousNodeArray, parentNode);
                }
            }

            // Need to applyBindings *before* unmemoziation, because unmemoization might introduce extra nodes (that we don't want to re-bind)
            // whereas a regular applyBindings won't introduce new memoized nodes
            invokeForEachNodeInContinuousRange(firstNode, lastNode, function(node) {
                if (node.nodeType === 1 || node.nodeType === 8)
                    ko.applyBindings(bindingContext, node);
            });
            invokeForEachNodeInContinuousRange(firstNode, lastNode, function(node) {
                if (node.nodeType === 1 || node.nodeType === 8)
                    ko.memoization.unmemoizeDomNodeAndDescendants(node, [bindingContext]);
            });

            // Make sure any changes done by applyBindings or unmemoize are reflected in the array
            ko.utils.fixUpContinuousNodeArray(continuousNodeArray, parentNode);
        }
    }

    function getFirstNodeFromPossibleArray(nodeOrNodeArray) {
        return nodeOrNodeArray.nodeType ? nodeOrNodeArray
                                        : nodeOrNodeArray.length > 0 ? nodeOrNodeArray[0]
                                        : null;
    }

    function executeTemplate(targetNodeOrNodeArray, renderMode, template, bindingContext, options) {
        options = options || {};
        var firstTargetNode = targetNodeOrNodeArray && getFirstNodeFromPossibleArray(targetNodeOrNodeArray);
        var templateDocument = firstTargetNode && firstTargetNode.ownerDocument;
        var templateEngineToUse = (options['templateEngine'] || _templateEngine);
        ko.templateRewriting.ensureTemplateIsRewritten(template, templateEngineToUse, templateDocument);
        var renderedNodesArray = templateEngineToUse['renderTemplate'](template, bindingContext, options, templateDocument);

        // Loosely check result is an array of DOM nodes
        if ((typeof renderedNodesArray.length != "number") || (renderedNodesArray.length > 0 && typeof renderedNodesArray[0].nodeType != "number"))
            throw new Error("Template engine must return an array of DOM nodes");

        var haveAddedNodesToParent = false;
        switch (renderMode) {
            case "replaceChildren":
                ko.virtualElements.setDomNodeChildren(targetNodeOrNodeArray, renderedNodesArray);
                haveAddedNodesToParent = true;
                break;
            case "replaceNode":
                ko.utils.replaceDomNodes(targetNodeOrNodeArray, renderedNodesArray);
                haveAddedNodesToParent = true;
                break;
            case "ignoreTargetNode": break;
            default:
                throw new Error("Unknown renderMode: " + renderMode);
        }

        if (haveAddedNodesToParent) {
            activateBindingsOnContinuousNodeArray(renderedNodesArray, bindingContext);
            if (options['afterRender'])
                ko.dependencyDetection.ignore(options['afterRender'], null, [renderedNodesArray, bindingContext['$data']]);
        }

        return renderedNodesArray;
    }

    ko.renderTemplate = function (template, dataOrBindingContext, options, targetNodeOrNodeArray, renderMode) {
        options = options || {};
        if ((options['templateEngine'] || _templateEngine) == undefined)
            throw new Error("Set a template engine before calling renderTemplate");
        renderMode = renderMode || "replaceChildren";

        if (targetNodeOrNodeArray) {
            var firstTargetNode = getFirstNodeFromPossibleArray(targetNodeOrNodeArray);

            var whenToDispose = function () { return (!firstTargetNode) || !ko.utils.domNodeIsAttachedToDocument(firstTargetNode); }; // Passive disposal (on next evaluation)
            var activelyDisposeWhenNodeIsRemoved = (firstTargetNode && renderMode == "replaceNode") ? firstTargetNode.parentNode : firstTargetNode;

            return ko.dependentObservable( // So the DOM is automatically updated when any dependency changes
                function () {
                    // Ensure we've got a proper binding context to work with
                    var bindingContext = (dataOrBindingContext && (dataOrBindingContext instanceof ko.bindingContext))
                        ? dataOrBindingContext
                        : new ko.bindingContext(ko.utils.unwrapObservable(dataOrBindingContext));

                    // Support selecting template as a function of the data being rendered
                    var templateName = typeof(template) == 'function' ? template(bindingContext['$data'], bindingContext) : template;

                    var renderedNodesArray = executeTemplate(targetNodeOrNodeArray, renderMode, templateName, bindingContext, options);
                    if (renderMode == "replaceNode") {
                        targetNodeOrNodeArray = renderedNodesArray;
                        firstTargetNode = getFirstNodeFromPossibleArray(targetNodeOrNodeArray);
                    }
                },
                null,
                { disposeWhen: whenToDispose, disposeWhenNodeIsRemoved: activelyDisposeWhenNodeIsRemoved }
            );
        } else {
            // We don't yet have a DOM node to evaluate, so use a memo and render the template later when there is a DOM node
            return ko.memoization.memoize(function (domNode) {
                ko.renderTemplate(template, dataOrBindingContext, options, domNode, "replaceNode");
            });
        }
    };

    ko.renderTemplateForEach = function (template, arrayOrObservableArray, options, targetNode, parentBindingContext) {
        // Since setDomNodeChildrenFromArrayMapping always calls executeTemplateForArrayItem and then
        // activateBindingsCallback for added items, we can store the binding context in the former to use in the latter.
        var arrayItemContext;

        // This will be called by setDomNodeChildrenFromArrayMapping to get the nodes to add to targetNode
        var executeTemplateForArrayItem = function (arrayValue, index) {
            // Support selecting template as a function of the data being rendered
            arrayItemContext = parentBindingContext['createChildContext'](arrayValue, options['as'], function(context) {
                context['$index'] = index;
            });
            var templateName = typeof(template) == 'function' ? template(arrayValue, arrayItemContext) : template;
            return executeTemplate(null, "ignoreTargetNode", templateName, arrayItemContext, options);
        }

        // This will be called whenever setDomNodeChildrenFromArrayMapping has added nodes to targetNode
        var activateBindingsCallback = function(arrayValue, addedNodesArray, index) {
            activateBindingsOnContinuousNodeArray(addedNodesArray, arrayItemContext);
            if (options['afterRender'])
                options['afterRender'](addedNodesArray, arrayValue);
        };

        return ko.dependentObservable(function () {
            var unwrappedArray = ko.utils.unwrapObservable(arrayOrObservableArray) || [];
            if (typeof unwrappedArray.length == "undefined") // Coerce single value into array
                unwrappedArray = [unwrappedArray];

            // Filter out any entries marked as destroyed
            var filteredArray = ko.utils.arrayFilter(unwrappedArray, function(item) {
                return options['includeDestroyed'] || item === undefined || item === null || !ko.utils.unwrapObservable(item['_destroy']);
            });

            // Call setDomNodeChildrenFromArrayMapping, ignoring any observables unwrapped within (most likely from a callback function).
            // If the array items are observables, though, they will be unwrapped in executeTemplateForArrayItem and managed within setDomNodeChildrenFromArrayMapping.
            ko.dependencyDetection.ignore(ko.utils.setDomNodeChildrenFromArrayMapping, null, [targetNode, filteredArray, executeTemplateForArrayItem, options, activateBindingsCallback]);

        }, null, { disposeWhenNodeIsRemoved: targetNode });
    };

    var templateComputedDomDataKey = ko.utils.domData.nextKey();
    function disposeOldComputedAndStoreNewOne(element, newComputed) {
        var oldComputed = ko.utils.domData.get(element, templateComputedDomDataKey);
        if (oldComputed && (typeof(oldComputed.dispose) == 'function'))
            oldComputed.dispose();
        ko.utils.domData.set(element, templateComputedDomDataKey, (newComputed && newComputed.isActive()) ? newComputed : undefined);
    }

    ko.bindingHandlers['template'] = {
        'init': function(element, valueAccessor) {
            // Support anonymous templates
            var bindingValue = ko.utils.unwrapObservable(valueAccessor());
            if (typeof bindingValue == "string" || bindingValue['name']) {
                // It's a named template - clear the element
                ko.virtualElements.emptyNode(element);
            } else {
                // It's an anonymous template - store the element contents, then clear the element
                var templateNodes = ko.virtualElements.childNodes(element),
                    container = ko.utils.moveCleanedNodesToContainerElement(templateNodes); // This also removes the nodes from their current parent
                new ko.templateSources.anonymousTemplate(element)['nodes'](container);
            }
            return { 'controlsDescendantBindings': true };
        },
        'update': function (element, valueAccessor, allBindings, viewModel, bindingContext) {
            var templateName = ko.utils.unwrapObservable(valueAccessor()),
                options = {},
                shouldDisplay = true,
                dataValue,
                templateComputed = null;

            if (typeof templateName != "string") {
                options = templateName;
                templateName = ko.utils.unwrapObservable(options['name']);

                // Support "if"/"ifnot" conditions
                if ('if' in options)
                    shouldDisplay = ko.utils.unwrapObservable(options['if']);
                if (shouldDisplay && 'ifnot' in options)
                    shouldDisplay = !ko.utils.unwrapObservable(options['ifnot']);

                dataValue = ko.utils.unwrapObservable(options['data']);
            }

            if ('foreach' in options) {
                // Render once for each data point (treating data set as empty if shouldDisplay==false)
                var dataArray = (shouldDisplay && options['foreach']) || [];
                templateComputed = ko.renderTemplateForEach(templateName || element, dataArray, options, element, bindingContext);
            } else if (!shouldDisplay) {
                ko.virtualElements.emptyNode(element);
            } else {
                // Render once for this single data point (or use the viewModel if no data was provided)
                var innerBindingContext = ('data' in options) ?
                    bindingContext['createChildContext'](dataValue, options['as']) :  // Given an explitit 'data' value, we create a child binding context for it
                    bindingContext;                                                        // Given no explicit 'data' value, we retain the same binding context
                templateComputed = ko.renderTemplate(templateName || element, innerBindingContext, options, element);
            }

            // It only makes sense to have a single template computed per element (otherwise which one should have its output displayed?)
            disposeOldComputedAndStoreNewOne(element, templateComputed);
        }
    };

    // Anonymous templates can't be rewritten. Give a nice error message if you try to do it.
    ko.expressionRewriting.bindingRewriteValidators['template'] = function(bindingValue) {
        var parsedBindingValue = ko.expressionRewriting.parseObjectLiteral(bindingValue);

        if ((parsedBindingValue.length == 1) && parsedBindingValue[0]['unknown'])
            return null; // It looks like a string literal, not an object literal, so treat it as a named template (which is allowed for rewriting)

        if (ko.expressionRewriting.keyValueArrayContainsKey(parsedBindingValue, "name"))
            return null; // Named templates can be rewritten, so return "no error"
        return "This template engine does not support anonymous templates nested within its templates";
    };

    ko.virtualElements.allowedBindings['template'] = true;
})();

ko.exportSymbol('setTemplateEngine', ko.setTemplateEngine);
ko.exportSymbol('renderTemplate', ko.renderTemplate);

ko.utils.compareArrays = (function () {
    var statusNotInOld = 'added', statusNotInNew = 'deleted';

    // Simple calculation based on Levenshtein distance.
    function compareArrays(oldArray, newArray, options) {
        // For backward compatibility, if the third arg is actually a bool, interpret
        // it as the old parameter 'dontLimitMoves'. Newer code should use { dontLimitMoves: true }.
        options = (typeof options === 'boolean') ? { 'dontLimitMoves': options } : (options || {});
        oldArray = oldArray || [];
        newArray = newArray || [];

        if (oldArray.length <= newArray.length)
            return compareSmallArrayToBigArray(oldArray, newArray, statusNotInOld, statusNotInNew, options);
        else
            return compareSmallArrayToBigArray(newArray, oldArray, statusNotInNew, statusNotInOld, options);
    }

    function compareSmallArrayToBigArray(smlArray, bigArray, statusNotInSml, statusNotInBig, options) {
        var myMin = Math.min,
            myMax = Math.max,
            editDistanceMatrix = [],
            smlIndex, smlIndexMax = smlArray.length,
            bigIndex, bigIndexMax = bigArray.length,
            compareRange = (bigIndexMax - smlIndexMax) || 1,
            maxDistance = smlIndexMax + bigIndexMax + 1,
            thisRow, lastRow,
            bigIndexMaxForRow, bigIndexMinForRow;

        for (smlIndex = 0; smlIndex <= smlIndexMax; smlIndex++) {
            lastRow = thisRow;
            editDistanceMatrix.push(thisRow = []);
            bigIndexMaxForRow = myMin(bigIndexMax, smlIndex + compareRange);
            bigIndexMinForRow = myMax(0, smlIndex - 1);
            for (bigIndex = bigIndexMinForRow; bigIndex <= bigIndexMaxForRow; bigIndex++) {
                if (!bigIndex)
                    thisRow[bigIndex] = smlIndex + 1;
                else if (!smlIndex)  // Top row - transform empty array into new array via additions
                    thisRow[bigIndex] = bigIndex + 1;
                else if (smlArray[smlIndex - 1] === bigArray[bigIndex - 1])
                    thisRow[bigIndex] = lastRow[bigIndex - 1];                  // copy value (no edit)
                else {
                    var northDistance = lastRow[bigIndex] || maxDistance;       // not in big (deletion)
                    var westDistance = thisRow[bigIndex - 1] || maxDistance;    // not in small (addition)
                    thisRow[bigIndex] = myMin(northDistance, westDistance) + 1;
                }
            }
        }

        var editScript = [], meMinusOne, notInSml = [], notInBig = [];
        for (smlIndex = smlIndexMax, bigIndex = bigIndexMax; smlIndex || bigIndex;) {
            meMinusOne = editDistanceMatrix[smlIndex][bigIndex] - 1;
            if (bigIndex && meMinusOne === editDistanceMatrix[smlIndex][bigIndex-1]) {
                notInSml.push(editScript[editScript.length] = {     // added
                    'status': statusNotInSml,
                    'value': bigArray[--bigIndex],
                    'index': bigIndex });
            } else if (smlIndex && meMinusOne === editDistanceMatrix[smlIndex - 1][bigIndex]) {
                notInBig.push(editScript[editScript.length] = {     // deleted
                    'status': statusNotInBig,
                    'value': smlArray[--smlIndex],
                    'index': smlIndex });
            } else {
                --bigIndex;
                --smlIndex;
                if (!options['sparse']) {
                    editScript.push({
                        'status': "retained",
                        'value': bigArray[bigIndex] });
                }
            }
        }

        if (notInSml.length && notInBig.length) {
            // Set a limit on the number of consecutive non-matching comparisons; having it a multiple of
            // smlIndexMax keeps the time complexity of this algorithm linear.
            var limitFailedCompares = smlIndexMax * 10, failedCompares,
                a, d, notInSmlItem, notInBigItem;
            // Go through the items that have been added and deleted and try to find matches between them.
            for (failedCompares = a = 0; (options['dontLimitMoves'] || failedCompares < limitFailedCompares) && (notInSmlItem = notInSml[a]); a++) {
                for (d = 0; notInBigItem = notInBig[d]; d++) {
                    if (notInSmlItem['value'] === notInBigItem['value']) {
                        notInSmlItem['moved'] = notInBigItem['index'];
                        notInBigItem['moved'] = notInSmlItem['index'];
                        notInBig.splice(d,1);       // This item is marked as moved; so remove it from notInBig list
                        failedCompares = d = 0;     // Reset failed compares count because we're checking for consecutive failures
                        break;
                    }
                }
                failedCompares += d;
            }
        }
        return editScript.reverse();
    }

    return compareArrays;
})();

ko.exportSymbol('utils.compareArrays', ko.utils.compareArrays);

(function () {
    // Objective:
    // * Given an input array, a container DOM node, and a function from array elements to arrays of DOM nodes,
    //   map the array elements to arrays of DOM nodes, concatenate together all these arrays, and use them to populate the container DOM node
    // * Next time we're given the same combination of things (with the array possibly having mutated), update the container DOM node
    //   so that its children is again the concatenation of the mappings of the array elements, but don't re-map any array elements that we
    //   previously mapped - retain those nodes, and just insert/delete other ones

    // "callbackAfterAddingNodes" will be invoked after any "mapping"-generated nodes are inserted into the container node
    // You can use this, for example, to activate bindings on those nodes.

    function mapNodeAndRefreshWhenChanged(containerNode, mapping, valueToMap, callbackAfterAddingNodes, index) {
        // Map this array value inside a dependentObservable so we re-map when any dependency changes
        var mappedNodes = [];
        var dependentObservable = ko.dependentObservable(function() {
            var newMappedNodes = mapping(valueToMap, index, ko.utils.fixUpContinuousNodeArray(mappedNodes, containerNode)) || [];

            // On subsequent evaluations, just replace the previously-inserted DOM nodes
            if (mappedNodes.length > 0) {
                ko.utils.replaceDomNodes(mappedNodes, newMappedNodes);
                if (callbackAfterAddingNodes)
                    ko.dependencyDetection.ignore(callbackAfterAddingNodes, null, [valueToMap, newMappedNodes, index]);
            }

            // Replace the contents of the mappedNodes array, thereby updating the record
            // of which nodes would be deleted if valueToMap was itself later removed
            mappedNodes.splice(0, mappedNodes.length);
            ko.utils.arrayPushAll(mappedNodes, newMappedNodes);
        }, null, { disposeWhenNodeIsRemoved: containerNode, disposeWhen: function() { return !ko.utils.anyDomNodeIsAttachedToDocument(mappedNodes); } });
        return { mappedNodes : mappedNodes, dependentObservable : (dependentObservable.isActive() ? dependentObservable : undefined) };
    }

    var lastMappingResultDomDataKey = ko.utils.domData.nextKey();

    ko.utils.setDomNodeChildrenFromArrayMapping = function (domNode, array, mapping, options, callbackAfterAddingNodes) {
        // Compare the provided array against the previous one
        array = array || [];
        options = options || {};
        var isFirstExecution = ko.utils.domData.get(domNode, lastMappingResultDomDataKey) === undefined;
        var lastMappingResult = ko.utils.domData.get(domNode, lastMappingResultDomDataKey) || [];
        var lastArray = ko.utils.arrayMap(lastMappingResult, function (x) { return x.arrayEntry; });
        var editScript = ko.utils.compareArrays(lastArray, array, options['dontLimitMoves']);

        // Build the new mapping result
        var newMappingResult = [];
        var lastMappingResultIndex = 0;
        var newMappingResultIndex = 0;

        var nodesToDelete = [];
        var itemsToProcess = [];
        var itemsForBeforeRemoveCallbacks = [];
        var itemsForMoveCallbacks = [];
        var itemsForAfterAddCallbacks = [];
        var mapData;

        function itemMovedOrRetained(editScriptIndex, oldPosition) {
            mapData = lastMappingResult[oldPosition];
            if (newMappingResultIndex !== oldPosition)
                itemsForMoveCallbacks[editScriptIndex] = mapData;
            // Since updating the index might change the nodes, do so before calling fixUpContinuousNodeArray
            mapData.indexObservable(newMappingResultIndex++);
            ko.utils.fixUpContinuousNodeArray(mapData.mappedNodes, domNode);
            newMappingResult.push(mapData);
            itemsToProcess.push(mapData);
        }

        function callCallback(callback, items) {
            if (callback) {
                for (var i = 0, n = items.length; i < n; i++) {
                    if (items[i]) {
                        ko.utils.arrayForEach(items[i].mappedNodes, function(node) {
                            callback(node, i, items[i].arrayEntry);
                        });
                    }
                }
            }
        }

        for (var i = 0, editScriptItem, movedIndex; editScriptItem = editScript[i]; i++) {
            movedIndex = editScriptItem['moved'];
            switch (editScriptItem['status']) {
                case "deleted":
                    if (movedIndex === undefined) {
                        mapData = lastMappingResult[lastMappingResultIndex];

                        // Stop tracking changes to the mapping for these nodes
                        if (mapData.dependentObservable)
                            mapData.dependentObservable.dispose();

                        // Queue these nodes for later removal
                        nodesToDelete.push.apply(nodesToDelete, ko.utils.fixUpContinuousNodeArray(mapData.mappedNodes, domNode));
                        if (options['beforeRemove']) {
                            itemsForBeforeRemoveCallbacks[i] = mapData;
                            itemsToProcess.push(mapData);
                        }
                    }
                    lastMappingResultIndex++;
                    break;

                case "retained":
                    itemMovedOrRetained(i, lastMappingResultIndex++);
                    break;

                case "added":
                    if (movedIndex !== undefined) {
                        itemMovedOrRetained(i, movedIndex);
                    } else {
                        mapData = { arrayEntry: editScriptItem['value'], indexObservable: ko.observable(newMappingResultIndex++) };
                        newMappingResult.push(mapData);
                        itemsToProcess.push(mapData);
                        if (!isFirstExecution)
                            itemsForAfterAddCallbacks[i] = mapData;
                    }
                    break;
            }
        }

        // Call beforeMove first before any changes have been made to the DOM
        callCallback(options['beforeMove'], itemsForMoveCallbacks);

        // Next remove nodes for deleted items (or just clean if there's a beforeRemove callback)
        ko.utils.arrayForEach(nodesToDelete, options['beforeRemove'] ? ko.cleanNode : ko.removeNode);

        // Next add/reorder the remaining items (will include deleted items if there's a beforeRemove callback)
        for (var i = 0, nextNode = ko.virtualElements.firstChild(domNode), lastNode, node; mapData = itemsToProcess[i]; i++) {
            // Get nodes for newly added items
            if (!mapData.mappedNodes)
                ko.utils.extend(mapData, mapNodeAndRefreshWhenChanged(domNode, mapping, mapData.arrayEntry, callbackAfterAddingNodes, mapData.indexObservable));

            // Put nodes in the right place if they aren't there already
            for (var j = 0; node = mapData.mappedNodes[j]; nextNode = node.nextSibling, lastNode = node, j++) {
                if (node !== nextNode)
                    ko.virtualElements.insertAfter(domNode, node, lastNode);
            }

            // Run the callbacks for newly added nodes (for example, to apply bindings, etc.)
            if (!mapData.initialized && callbackAfterAddingNodes) {
                callbackAfterAddingNodes(mapData.arrayEntry, mapData.mappedNodes, mapData.indexObservable);
                mapData.initialized = true;
            }
        }

        // If there's a beforeRemove callback, call it after reordering.
        // Note that we assume that the beforeRemove callback will usually be used to remove the nodes using
        // some sort of animation, which is why we first reorder the nodes that will be removed. If the
        // callback instead removes the nodes right away, it would be more efficient to skip reordering them.
        // Perhaps we'll make that change in the future if this scenario becomes more common.
        callCallback(options['beforeRemove'], itemsForBeforeRemoveCallbacks);

        // Finally call afterMove and afterAdd callbacks
        callCallback(options['afterMove'], itemsForMoveCallbacks);
        callCallback(options['afterAdd'], itemsForAfterAddCallbacks);

        // Store a copy of the array items we just considered so we can difference it next time
        ko.utils.domData.set(domNode, lastMappingResultDomDataKey, newMappingResult);
    }
})();

ko.exportSymbol('utils.setDomNodeChildrenFromArrayMapping', ko.utils.setDomNodeChildrenFromArrayMapping);
ko.nativeTemplateEngine = function () {
    this['allowTemplateRewriting'] = false;
}

ko.nativeTemplateEngine.prototype = new ko.templateEngine();
ko.nativeTemplateEngine.prototype.constructor = ko.nativeTemplateEngine;
ko.nativeTemplateEngine.prototype['renderTemplateSource'] = function (templateSource, bindingContext, options) {
    var useNodesIfAvailable = !(ko.utils.ieVersion < 9), // IE<9 cloneNode doesn't work properly
        templateNodesFunc = useNodesIfAvailable ? templateSource['nodes'] : null,
        templateNodes = templateNodesFunc ? templateSource['nodes']() : null;

    if (templateNodes) {
        return ko.utils.makeArray(templateNodes.cloneNode(true).childNodes);
    } else {
        var templateText = templateSource['text']();
        return ko.utils.parseHtmlFragment(templateText);
    }
};

ko.nativeTemplateEngine.instance = new ko.nativeTemplateEngine();
ko.setTemplateEngine(ko.nativeTemplateEngine.instance);

ko.exportSymbol('nativeTemplateEngine', ko.nativeTemplateEngine);
(function() {
    ko.jqueryTmplTemplateEngine = function () {
        // Detect which version of jquery-tmpl you're using. Unfortunately jquery-tmpl
        // doesn't expose a version number, so we have to infer it.
        // Note that as of Knockout 1.3, we only support jQuery.tmpl 1.0.0pre and later,
        // which KO internally refers to as version "2", so older versions are no longer detected.
        var jQueryTmplVersion = this.jQueryTmplVersion = (function() {
            if ((typeof(jQuery) == "undefined") || !(jQuery['tmpl']))
                return 0;
            // Since it exposes no official version number, we use our own numbering system. To be updated as jquery-tmpl evolves.
            try {
                if (jQuery['tmpl']['tag']['tmpl']['open'].toString().indexOf('__') >= 0) {
                    // Since 1.0.0pre, custom tags should append markup to an array called "__"
                    return 2; // Final version of jquery.tmpl
                }
            } catch(ex) { /* Apparently not the version we were looking for */ }

            return 1; // Any older version that we don't support
        })();

        function ensureHasReferencedJQueryTemplates() {
            if (jQueryTmplVersion < 2)
                throw new Error("Your version of jQuery.tmpl is too old. Please upgrade to jQuery.tmpl 1.0.0pre or later.");
        }

        function executeTemplate(compiledTemplate, data, jQueryTemplateOptions) {
            return jQuery['tmpl'](compiledTemplate, data, jQueryTemplateOptions);
        }

        this['renderTemplateSource'] = function(templateSource, bindingContext, options) {
            options = options || {};
            ensureHasReferencedJQueryTemplates();

            // Ensure we have stored a precompiled version of this template (don't want to reparse on every render)
            var precompiled = templateSource['data']('precompiled');
            if (!precompiled) {
                var templateText = templateSource['text']() || "";
                // Wrap in "with($whatever.koBindingContext) { ... }"
                templateText = "{{ko_with $item.koBindingContext}}" + templateText + "{{/ko_with}}";

                precompiled = jQuery['template'](null, templateText);
                templateSource['data']('precompiled', precompiled);
            }

            var data = [bindingContext['$data']]; // Prewrap the data in an array to stop jquery.tmpl from trying to unwrap any arrays
            var jQueryTemplateOptions = jQuery['extend']({ 'koBindingContext': bindingContext }, options['templateOptions']);

            var resultNodes = executeTemplate(precompiled, data, jQueryTemplateOptions);
            resultNodes['appendTo'](document.createElement("div")); // Using "appendTo" forces jQuery/jQuery.tmpl to perform necessary cleanup work

            jQuery['fragments'] = {}; // Clear jQuery's fragment cache to avoid a memory leak after a large number of template renders
            return resultNodes;
        };

        this['createJavaScriptEvaluatorBlock'] = function(script) {
            return "{{ko_code ((function() { return " + script + " })()) }}";
        };

        this['addTemplate'] = function(templateName, templateMarkup) {
            document.write("<script type='text/html' id='" + templateName + "'>" + templateMarkup + "<" + "/script>");
        };

        if (jQueryTmplVersion > 0) {
            jQuery['tmpl']['tag']['ko_code'] = {
                open: "__.push($1 || '');"
            };
            jQuery['tmpl']['tag']['ko_with'] = {
                open: "with($1) {",
                close: "} "
            };
        }
    };

    ko.jqueryTmplTemplateEngine.prototype = new ko.templateEngine();
    ko.jqueryTmplTemplateEngine.prototype.constructor = ko.jqueryTmplTemplateEngine;

    // Use this one by default *only if jquery.tmpl is referenced*
    var jqueryTmplTemplateEngineInstance = new ko.jqueryTmplTemplateEngine();
    if (jqueryTmplTemplateEngineInstance.jQueryTmplVersion > 0)
        ko.setTemplateEngine(jqueryTmplTemplateEngineInstance);

    ko.exportSymbol('jqueryTmplTemplateEngine', ko.jqueryTmplTemplateEngine);
})();
}));
}());
})();



});


window.ko = require('ko');



// these variables should not be used directly but accessed via the 'br.app-meta-service' instead
window.$BRJS_APP_VERSION = '1412085502554';
window.$BRJS_VERSIONED_BUNDLE_PATH = 'v/1412085502554';
window.$BRJS_LOCALE_COOKIE_NAME = 'BRJS.LOCALE';
window.$BRJS_APP_LOCALES = {'en':true};


// br/EventHub
define('br/EventHub', function(require, exports, module) {
"use strict";

/**
* A simple in browser event hub.
* Consists of multiple 'channels' where each channel is an <code>Emitr</code>.
*
* @module br/EventHub
* @see {@link https://bladerunnerjs.github.io/emitr/}
* @see {@link http://bladerunnerjs.org/docs/concepts/event_hub/}
*/

var Emitter = require( 'emitr' );
var br = require( 'br/Core' );

/**
* @class
* @alias module:br/EventHub
* 
* @classdesc
* Create the event hub. This generally isn't required as it's already constructed
* and made available to apps via the [Service Registry]{@link module:br/ServiceRegistry}
*/
var EventHub = function() {
  Emitter.apply( this );
	this.channels = {};
};
br.extend( EventHub, Emitter );

/**
* Get a named channel from the event hub.
*
* @param {String} channelName The name of the channel
* @returns An [Emitr]{@link https://bladerunnerjs.github.io/emitr/} object.
* @see {@link https://bladerunnerjs.github.io/emitr/}
*/
EventHub.prototype.channel = function( channelName ) {
	if ( !this.channels[ channelName ] ) {
		this.channels[ channelName ] = new Channel( channelName );
    this.trigger( 'new-channel', this.channels[ channelName ] );	//TODO: make this a META event
	}
	return this.channels[ channelName ];
};

/** @private **/
function Channel( name ) {
  Emitter.apply( this );
	this.name = name;
}
br.extend( Channel, Emitter );


module.exports = EventHub;

});


// br/Core
define('br/Core', function(require, exports, module) {
"use strict";

/**
* Provides access to Object Oriented JavaScript utilities
* Uses <code>Topiarist</code> to provide most of the OO functionality.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
*
* @module br/Core
*/

var topiarist = require('topiarist');
topiarist.exportTo(exports);


/**
* Extend one class from another.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
* @name extend
* @memberof module:br/Core
* @static
* @function
* @param {Class} subclass
* @param {Class} superclass
*/
// topiarist.extend(subclass, superclass) - included by 'topiarist.exportTo(exports);' above

/**
* Delcares that a class has implemented an interface and throws an exception
* if it does not.
*
* Should be called after the class and all of its methods have been defined.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
*   This method is the same as topiarist.implement(class, interface)
* @method
* @param {Class} class The class implementing the interface.
* @param {Class} interface The interface
*/
exports.hasImplemented = exports.implement;

/**
* Delcares that a class will implement an interface.
* This is similar to {@link exports.hasImplemented} but can be called before
* a class' methods have been defined.
*
* @param {Class} implementor The class implementing the interface.
* @param {Class} theInterface The interface
*/
exports.implement = function(implementor, theInterface) {
	// We do this on a timeout so you can implement the methods later.
	var br = topiarist;
	var error = new Error();
	setTimeout(function() {
		try {
			br.implement(implementor, theInterface);
		} catch (e) {
			error.message = e.message;
			error.name = e.name;
			throw error;
		}
	}, 0);
};

/**
* Provides multiple inheritance by copying functionality from the parent to the class.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
* @name inherit
* @memberof module:br/Core
* @static
* @function
* @param {Class} class
* @param {Class} parent
*/
// topiarist.inherit(class, parent) - included by 'topiarist.exportTo(exports);' above

/**
* Provides mixin inheritance, sandboxing mixin methods that are copied onto the class.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
* @name mixin
* @memberof module:br/Core
* @static
* @function
* @param {Class} class
* @param {Class} mixin
*/
// topiarist.mixin(class, mixin) - included by 'topiarist.exportTo(exports);' above

/**
* Returns true if the instance is of a type which has been declared to be
* descended from the parent, e.g. because it’s extended or implemented or mixed-in.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
* @name isA
* @memberof module:br/Core
* @static
* @function
* @param {Object} instance
* @param {Class} parent
*/
// topiarist.isA(instance, parent) - included by 'topiarist.exportTo(exports);' above

/**
* Returns true if the class has been declared to be descended from the parent,
* e.g. through extension, implementation, etc.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
* @name classIsA
* @memberof module:br/Core
* @static
* @function
* @param {Class}
* @param {Class} parent
*/
// topiarist.classIsA(class, parent) - included by 'topiarist.exportTo(exports);' above

/**
* Returns true if the instance supports everything on the interface.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
* @name fulfills
* @memberof module:br/Core
* @static
* @function
* @param {Class} instance
* @param {Class} interfac}
*/
// topiarist.fulfills(instance, interface) - included by 'topiarist.exportTo(exports);' above

/**
* Returns true if instances of the class will be created supporting everything on the interface.
*
* @see {@link http://bladerunnerjs.github.io/topiarist/}
* @name classFulfills
* @memberof module:br/Core
* @static
* @function
* @param {Object} instance
* @param {Class} interface
*/
// topiarist.classFulfills(instance, interface) - included by 'topiarist.exportTo(exports);' above

exports.thirdparty = function(library){};

});


// br/ServiceRegistry
define('br/ServiceRegistry', function(require, exports, module) {
/**
 * @module br/ServiceRegistry
 */

var ServiceRegistryClass = require('br/ServiceRegistryClass');

/**
 * @type module:br/ServiceRegistryClass
 */
module.exports = new ServiceRegistryClass();

});


// br/ServiceRegistryClass
define('br/ServiceRegistryClass', function(require, exports, module) {
"use strict";

/**
 * @module br/ServiceRegistryClass
 */

var Errors = require('./Errors');
var AliasRegistry = require('./AliasRegistry');

/**
* @class
* @alias module:br/ServiceRegistryClass
* 
* @classdesc
* The <code>ServiceRegistryClass</code> is used to allow a given application access to application
* services. The <code>ServiceRegistryClass</code> is a static class and does not need to be constructed.
* 
* <p>Services are typically registered or requested using an alias name, but older applications
* may still register and request using interfaces, which is also still supported. Applications
* that use aliases don't normally need to manually register services as these are created lazily
* upon first request, but will still need to manually register services that can't be created
* using a zero-arg constructor.</p>
*
* <p>The <code>ServiceRegistryClass</code> is initialized as follows:</p>
*
* <ol>
*	<li>The application invokes {@link module:br/ServiceRegistryClass/initializeServices} which
*		causes all delayed readiness services to be created.</li>
*	<li>Once {@link module:br/ServiceRegistryClass/initializeServices} has finished (once one of the
*		call-backs fire), the application should then register any services that can't be created
*		lazily using zero-arg constructors.</li>
*	<li>The application can now start doing it's proper work.</li>
* </ol>
*
* <p>Because blades aren't allowed to depend directly on classes in other blades, interface
* definitions are instead created for particular pieces of functionality, and blades can choose
* to register themselves as being providers of that functionality. The
* <code>ServiceRegistryClass</code> and the {@link module:br/EventHub} are both useful in this
* regard:
*
* <ul>
*	<li>Many-To-One dependencies are resolved by having a single service instance available via
*		the <code>ServiceRegistryClass</code>.</li>
*	<li>Many-To-Many dependencies are resolved by having zero or more classes register with the
*		{@link module:br/EventHub}.</li>
* </ul>
* 
* @see {@link http://bladerunnerjs.org/docs/concepts/service_registry/}
* @see {@link http://bladerunnerjs.org/docs/use/service_registry/}
*/
function ServiceRegistryClass() {
	this.registry = {};
};

// Main API //////////////////////////////////////////////////////////////////////////////////////

/**
* Register an object that will be responsible for implementing the given interface within the
* application.
*
* @param {String} identifier The alias used to uniquely identify the service.
* @param {Object} serviceInstance The object responsible for providing the service.
* @throws {Error} If a service has already been registered for the given interface or if no
* 		instance object is provided.
*/
ServiceRegistryClass.prototype.registerService = function(alias, serviceInstance) {
	if (serviceInstance === undefined) {
		throw new Errors.InvalidParametersError("The service instance is undefined.");
	}

	if (alias in this.registry) {
		throw new Errors.IllegalStateError("Service: " + alias + " has already been registered.");
	}

	this.registry[alias] = serviceInstance;
};

/**
* De-register a service that is currently registered in the <code>ServiceRegistryClass</code>.
*
* @param {String} sIdentifier The alias or interface name used to uniquely identify the service.
*/
ServiceRegistryClass.prototype.deregisterService = function(alias) {
	delete this.registry[alias];
};

/**
* Retrieve the service linked to the identifier within the application. The identifier could be a
* service alias or a service interface.
*
* @param {String} identifier The alias or interface name used to uniquely identify the service.
* @throws {Error} If no service could be found for the given identifier.
* @type Object
*/
ServiceRegistryClass.prototype.getService = function(alias) {
	this._initializeServiceIfRequired(alias);

	if (this.registry[alias] === undefined){
		throw new Errors.InvalidParametersError("br/ServiceRegistryClass could not locate a service for: " + alias);
	}

	return this.registry[alias];
};

/**
* Determine whether a service has been registered for a given identifier.
*
* @param {String} identifier The alias or interface name used to uniquely identify the service.
* @type boolean
*/
ServiceRegistryClass.prototype.isServiceRegistered = function(alias) {
	return alias in this.registry;
};

/**
* Resets the <code>ServiceRegistryClass</code> back to its initial state.
*
* <p>This method isn't normally called within an application, but is called automatically before
* each test is run.</p>
*/
ServiceRegistryClass.prototype.clear = function() {
	this.registry = {};
};

/** @private */
ServiceRegistryClass.prototype._initializeServiceIfRequired = function(alias) {
	if (alias in this.registry === false) {
		var isIdentifierAlias = AliasRegistry.isAliasAssigned(alias);

		if (isIdentifierAlias) {
			var ServiceClass = AliasRegistry.getClass(alias);

			this.registry[alias] = new ServiceClass();
		}
	}
};

module.exports = ServiceRegistryClass;

});


// br/Errors
define('br/Errors', function(require, exports, module) {
"use strict";

/**
* @module br/Errors
*/

var br = require('br/Core');

/**
* @class
* @alias module:br/Errors
* 
* @classdesc
* Constructs a new <code>Error</code> of the provided type.
* 
* <code>br/Errors</code> extends the built in <code>Error</code> and allows the
* error type to be specified in the constructor. The <code>name</code>
* property is set to the specified type.
* 
* @param {String} type The error type to be thrown.
* @param {String} message A human-readable description of the error.
* @param {String} [fileName] (Optional) The name of the file containing the code that caused the error.
* @param {int} [lineNumber] (Optional) The line number of the code that caused the error.
*/
function CustomError(type, message, fileName, lineNumber) {
	this.name = type || "";
	this.message = message || "";
	this.fileName = fileName;
	this.lineNumber = lineNumber;

	// If the browser we're in provides an ability to get the stack, then get it here.
	var e = new Error();
	if (e.stack) {
		this.realStack = e.stack;
		this.stack = "Error: "+type+": "+message+"\n\tat "+getStack(e).join("\n\tat ");
	}
}

br.extend(CustomError, Error);

/**
* Returns the string representation of this error
*/
CustomError.prototype.toString = function toString() {
	return this.stack || this.message;
};

exports.CustomError = CustomError;

/**
 * This error type is thrown when a method has been invoked at an illegal or
 * inappropriate time.
 */
exports.ILLEGAL_STATE = "IllegalStateError";

/**
 * This error type is thrown from acceptance test fixtures and indicates a
 * problem with the test rather than the code under test. For example, if a
 * particular fixture can only be used in a 'given' clause but is invoked in a
 * 'then' clause, this error will be thrown. This will result in a test 'error'
 * rather than a test 'failure'.
 */
exports.INVALID_TEST = "InvalidTestError";
exports.ILLEGAL_TEST_CLAUSE = "IllegalTestClauseError";

/**
 * This error is thrown when an interface method is called that should have
 * been implemented in the interface implementor class.
 */
exports.UNIMPLEMENTED_INTERFACE = "UnimplementedInterfaceError";

/**
 * This error is thrown when an abstract method is called that should have
 * been implemented in the extending class.
 */
exports.UNIMPLEMENTED_ABSTRACT_METHOD = "UnimplementedAbstractMethodError";

/**
 * This error is thrown when an operation is being attempted on an a class instance
 * and it does not have the required implementation.
 */
exports.NOT_SUPPORTED = "NotSupportedError";

/**
 * This error type is thrown when a method is called with one or more invalid
 * parameters. This could either be because a required parameter is not provided
 * or a provided parameter is of the wrong type or is invalid for another reason
 * (eg a string representation of a date that doesn't parse to an actual date).
 */
exports.INVALID_PARAMETERS = "InvalidParametersError";

/**
 * This error type indicates that a request for data has failed.
 */
exports.REQUEST_FAILED = "RequestFailedError";

/**
 * This error type indicates that some required data was invalid.
 */
exports.INVALID_DATA = "InvalidDataError";

function getCustomErrorConstructor(type) {
	var customErrorConstructor = function(message, filename, lineNumber) {
		CustomError.call(this, type, message, filename, lineNumber);
	};
	br.extend(customErrorConstructor, CustomError);
	return customErrorConstructor;
}

for (var key in exports) {
	if (typeof exports[key] === 'string') {
		var className = exports[key];
		exports[className] = getCustomErrorConstructor(className);
	}
}

exports.EVAL = "EvalError";
exports.EvalError = EvalError;
exports.RANGE = "RangeError";
exports.RangeError = RangeError;
exports.REFERENCE = "ReferenceError";
exports.ReferenceError = ReferenceError;
exports.SYNTAX = "SyntaxError";
exports.SyntaxError = SyntaxError;
exports.TYPE = "TypeError";
exports.TypeError = TypeError;


// static private methods /////////////////////////////////////////////////////

/** @private */
function normaliseStack(stackString) {
	var stack;

	if(stackString) {
		stack = stackString.split("\n");
		for (var i = stack.length - 1; i >= 0; --i) {
			if (stack[i] === 'Error' || stack[i] === '') {
				stack.splice(i, 1);
			} else {
				var header = stack[i].match(/^\s*at\s+/);
				if (header !== null) {
					stack[i] = stack[i].substring(header[0].length);
				}
			}
		}
	}
	return stack;
}

/** @private */
var irrelevantStack = normaliseStack((new (getCustomErrorConstructor('irrelevant'))()).realStack);

/** @private */
function getStack(e) {
	var stack = normaliseStack(e.stack);
	if (irrelevantStack !== undefined) {
		var line = 0;
		while (stack[0] === irrelevantStack[line++]) {
			stack.shift();
		}
	}
	return stack;
}

});


// br/AliasRegistry
define('br/AliasRegistry', function(require, exports, module) {
/**
 * @module br/AliasRegistry
 */

var AliasRegistryClass = require('br/AliasRegistryClass');

/**
 * @type module:br/AliasRegistryClass
 */
module.exports = new AliasRegistryClass();

});


// br/AliasRegistryClass
define('br/AliasRegistryClass', function(require, exports, module) {
"use strict";

/**
* @module br/AliasRegistryClass
*/

var br = require('br/Core');
var Errors = require('./Errors');

/**
* @class
* @alias module:br/AliasRegistryClass
* 
* @classdesc
* The <code>AliasRegistryClass</code> class provides access to the aliases used within
* the application.
*
* <p>An alias is simply an alternate logical name for a class, such that specifying
* this logical name in your source code, whether it be Javascript, HTML or CSS, will
* cause the class to be bundled and sent to the browser. It is therefore, at it's
* simplest, a mechanism for ensuring that all the code your app needs, and no more,
* is bundled and sent to the browser. Though class dependencies are usually specified
* by directly referring to other classes, there are times when this is
* inappropriate:</p>
*
* <ol>
*   <li>We sometimes need a level of indirection, so that dependencies can be expressed
*    without knowing the concrete class that will end up being used (e.g. services).</li>
*   <li>It is sometimes useful to specify components declaratively, where it would be confusing
*    to have to refer to the classes that provide some feature, rather than talking in terms
*    of the feature itself.</li>
* </ol>
*
* <p>Another useful facet of aliases is that they can be used to automatically
* discover all of the classes which implement a particular interface, which
* makes it a good candidate for creating SPI type, auto-discovery mechanisms.</p>
*/
var AliasRegistryClass = function()
{
	this._aliasData = null;
	this._isAliasDataSet = false;
};

/**
* Returns an array containing the names of all aliases in use within the application.
*
* @type Array
*/
AliasRegistryClass.prototype.getAllAliases = function getAllAliases() {
	this._ensureAliasDataHasBeenSet();
	return Object.keys(this._aliasData);
};

/**
* Returns a filtered subset of the aliases provided by
* {@link module:br/AliasRegistry/getAllAliases}.
*
* <p>An alias is considered to be associated with an interface if the XML configuration for that
* alias specifically mentions the given interface, or if the class the alias points to happens to
* implement the given interface.</p>
*
* @param {function} interface the interface being used to filter the aliases by.
* @type Array
*/
AliasRegistryClass.prototype.getAliasesByInterface = function getAliasesByInterface(protocol) {
	this._ensureAliasDataHasBeenSet();
	var allAliases = this.getAllAliases();
	var filteredAliases = [];

	for(var i = 0, length = allAliases.length; i < length; ++i) {
		var alias = allAliases[i];
		var aliasInterface = this._aliasData[alias]["interface"];

		if(aliasInterface === protocol) {
			filteredAliases.push(alias);
		} else if (this.isAliasAssigned(alias)) {
			var aliasClass = this.getClass(alias);

			if(br.classIsA(aliasClass, protocol)) {
				filteredAliases.push(alias);
			}
		}
	}

	return filteredAliases;
};

/**
* Returns a class corresponding to the requested alias name.
*
* @throws {Errors.IllegalState} if the given alias doesn't exist.
* @param {String} aliasName alias name.
* @type function
*/
AliasRegistryClass.prototype.getClass = function getClass(aliasName) {
	this._ensureAliasDataHasBeenSet();
	if (!this.isAliasAssigned(aliasName)) {
		throw new Errors.IllegalStateError("No class has been found for alias '" + aliasName +"'");
	}

	return this._aliasData[aliasName]["class"];
};

/**
* Returns whether the given alias is defined.
*
* @param {String} aliasName alias name.
* @type boolean
*/
AliasRegistryClass.prototype.isAlias = function isAlias(aliasName) {
	this._ensureAliasDataHasBeenSet();
	return aliasName in this._aliasData;
};

/**
* Returns whether the given alias has been assigned a value &mdash; i.e. whether an alias has a
* class value.
*
* @param {String} aliasName alias name.
* @type boolean
*/
AliasRegistryClass.prototype.isAliasAssigned = function isAliasAssigned(aliasName) {
	this._ensureAliasDataHasBeenSet();
	return this.isAlias(aliasName) && this._aliasData[aliasName]["class"] !== undefined;
};

/**
* Sets the alias data.
*
* If the alias data is inconsistent, this will throw Errors.
*/
AliasRegistryClass.prototype.setAliasData = function setAliasData(unverifiedAliasData) {
	if (this._isAliasDataSet === true) {
		throw new Errors.IllegalStateError("Alias data has already been set; unable to set again.");
	}

	this._isAliasDataSet = true;
	this._aliasData = unverifiedAliasData;

	var aliases = this.getAllAliases();
	var incorrectAliases = [];
	var i;

	for (i = 0; i < aliases.length; ++i) {
		var aliasId = aliases[i];
		var alias = this._aliasData[aliasId];

		if (this.isAliasAssigned(aliasId) && alias["interface"]) {
			var aliasClass = alias["class"];
			var protocol = alias["interface"];
			if (br.classIsA(aliasClass, protocol) == false) {
				incorrectAliases.push(aliasId);
			}
		}
	}

	if(incorrectAliases.length > 0) {
		var errorMessage = 'The classes for the following aliases do not implement their required interfaces: \n';
		for(i = 0; i < incorrectAliases.length; ++i)
		{
			var incorrectAlias = incorrectAliases[i];
			errorMessage += '[' + incorrectAlias + ']: "' + this._aliasData[incorrectAlias]["className"] + '" should implement "' + this._aliasData[incorrectAlias].interfaceName + '";\n';
		}
		this._isAliasDataSet = false;
		this._aliasData = null;
		throw new Errors.IllegalStateError(errorMessage);
	}
};

/**
* @private
*/
AliasRegistryClass.prototype._ensureAliasDataHasBeenSet = function() {
	if (this._isAliasDataSet !== true) {
		throw new Errors.IllegalStateError("Alias data has not been set.");
	}
}

module.exports = AliasRegistryClass;

});


// brjstodo/App
define('brjstodo/App', function(require, exports, module) {
var KnockoutComponent = require( 'br/knockout/KnockoutComponent' );
var InputViewModel = require( 'brjstodo/input/InputViewModel' );
var ItemsViewModel = require( 'brjstodo/items/ItemsViewModel' );
var FilterViewModel = require( 'brjstodo/filter/FilterViewModel' );

var ServiceRegistry = require( 'br/ServiceRegistry' );
var LocalStorageService = require( 'todomvc/LocalStorageService' );
var todoService = new LocalStorageService();
ServiceRegistry.registerService( 'todomvc.storage', todoService );

var App = function() {

  var todoAppEl = document.getElementById( 'todoapp' );

  // todo input Blade
  var inputModel = new InputViewModel();
  var inputComponent = new KnockoutComponent( 'brjstodo.input.view-template', inputModel );
  var inputEl = inputComponent.getElement();
  todoAppEl.appendChild( inputEl );

  // todo items Blade
  var itemsModel = new ItemsViewModel();
  var itemsComponent = new KnockoutComponent( 'brjstodo.items.view-template', itemsModel );
  var itemsEl = itemsComponent.getElement();
  todoAppEl.appendChild( itemsEl );

  // todo filter/footer
  var filterModel = new FilterViewModel();
  var filterComponent = new KnockoutComponent( 'brjstodo.filter.view-template', filterModel );
  var filterEl = filterComponent.getElement();
  todoAppEl.appendChild( filterEl );
};

module.exports = App;

});


// br/knockout/KnockoutComponent
define('br/knockout/KnockoutComponent', function(require, exports, module) {
"use strict";

/**
* @module br/knockout/KnockoutComponent
*/

var ko = require( 'ko' );
var br = require( 'br/Core' );
var Errors = require('br/Errors');
var Component = require( 'br/component/Component' );

var ServiceRegistry = require('br/ServiceRegistry');

/**
* @class
* @alias module:br/knockout/KnockoutComponent
* @implements module:br/component/Component
* 
* @classdesc
* Constructs a new instance of <code>KnockoutComponent</code>.
* 
* @param {String} sTemplateId The id of a template to render the presentation model with.
* @param {Object} oViewModel A Knockout View Model object instance.
*/
function KnockoutComponent(sTemplateId, vPresentationModel) {
  this.m_sTemplateId = sTemplateId;
  this.m_eTemplate = this._getTemplate(sTemplateId);
  this.m_oPresentationModel = vPresentationModel;
  this.m_bViewBound = false;
  this.m_bViewAttached = false;
}
br.implement( KnockoutComponent, Component );

/**
 * @private
 */
KnockoutComponent.TEMPLATE_NOT_FOUND = "TemplateNotFound";

/**
 * @private
 */
KnockoutComponent.TemplateNotFoundError = function(message, filename, lineNumber) {
  Errors.CustomError.call(this, KnockoutComponent.TEMPLATE_NOT_FOUND, message, filename, lineNumber);
};
br.extend(KnockoutComponent.TemplateNotFoundError, Errors.CustomError);

// *********************** Component Interface ***********************

KnockoutComponent.prototype.setDisplayFrame = function(frame) {
  this.m_oFrame = frame;

  frame.setContent(this.getElement());
};

KnockoutComponent.prototype.getElement = function() {
  if (!this.m_bViewBound) {
    this.m_bViewBound = true;
    ko.applyBindings(this.m_oPresentationModel, this.m_eTemplate);
  }

  return this.m_eTemplate;
};

/** @private */
KnockoutComponent.prototype._getTemplate = function(sTemplateId) {
	var eTemplateHolder;
	var eTemplateNode = ServiceRegistry.getService("br.html-service").getHTMLTemplate(sTemplateId);

	if (!eTemplateNode) {
	    throw new KnockoutComponent.TemplateNotFoundError("Template with ID "+sTemplateId+" couldn't be found");
	}

	eTemplateHolder = eTemplateNode.cloneNode(true);
	eTemplateHolder.removeAttribute('id');

	return eTemplateHolder;
};

module.exports = KnockoutComponent;

});


// br/services/html/BRHtmlResourceService
define('br/services/html/BRHtmlResourceService', function(require, exports, module) {
/**
* @module br/services/html/BRHtmlResourceService
*/

var br = require('br/Core');
var File = require('br/core/File');
var HtmlResourceService = require('br/services/HtmlResourceService');
var i18n = require('br/I18n');

/**
 * @class
 * @alias module:br/services/html/BRHtmlResourceService
 * @implements module:br/services/HtmlResourceService
 * 
 * @classdesc
 * Provides access to HTML templates loaded via the HTML bundler.
 * This is the default HtmlResourceService in BladeRunnerJS
 * 
 * @param {String} url A URL to load HTML from.
 */
function BRHtmlResourceService(url) {
	var ServiceRegistry = require("br/ServiceRegistry");
	/** @private */
	this.url = url || ServiceRegistry.getService('br.app-meta-service').getVersionedBundlePath("html/bundle.html");

	/** @private */
	this.templates = {};

	/** @private */
	this.element = document.createElement("div");
	this.element.style.display = "none";

	this._loadHtml();
}

/**
 * Access an HTML template by name.
 *
 * @param {String} templateId The identifier of the template that is required. Note that templates should be contained
 * within a template tag (preferably).
 *
 * @returns {HTMLElement}
 */
BRHtmlResourceService.prototype.getHTMLTemplate = function (templateId) {
	if (this.templates[templateId]) {
		return this.templates[templateId];
	}
	return document.getElementById(templateId);
};

/**
 * @private
 */
BRHtmlResourceService.prototype._loadHtml = function () {
	document.body.appendChild(this.element);

	var rawHtml = File.readFileSync(this.url);
	var translatedHtml = i18n.getTranslator().translate(rawHtml, "html");
	this.element.innerHTML = sanitizeHtml(translatedHtml);

	for (var i = 0, max = this.element.children.length; i < max; i++) {
		this.templates[this.element.children[i].id] = this.element.children[i].cloneNode(true);
	}

	document.body.removeChild(this.element);
};

function sanitizeHtml(html) {
	// IE and old Firefox's don't allow assigning text with script tag in it to innerHTML.
	if (html.match(/<script(.*)type=\"text\/html\"/)) {
	 	function replacer(str, p1) {
	 		return '<div' + p1;
	 	};
	 	// TODO: Log the fact there is a script tag in the template and that it should be replaced with a div.
	 	html = html.replace(/<script(.*)type=\"text\/html\"/g, replacer).replace(/<\/script>/g, '</div>');
	}

	return html;
};


br.implement(BRHtmlResourceService, HtmlResourceService);

module.exports = BRHtmlResourceService;

});


// br/services/appmeta/BRAppMetaService
define('br/services/appmeta/BRAppMetaService', function(require, exports, module) {
"use strict";

/**
* @module br/services/bundlepath/BRAppMetaService
*/

var br = require('br/Core');
var AppMetaService = require('br/services/AppMetaService');

/**
 * @class
 * @alias module:br/services/bundlepath/BRAppMetaService
 * @implements module:br/services/AppMetaService
 */
function BRAppMetaService() {
};

BRAppMetaService.prototype.getVersion = function() {
	return window.$BRJS_APP_VERSION;
};

BRAppMetaService.prototype.getVersionedBundlePath = function(bundlePath) {
	return getBundlePath(window.$BRJS_VERSIONED_BUNDLE_PATH, bundlePath);
};

BRAppMetaService.prototype.getLocales = function() {
	return window.$BRJS_APP_LOCALES;
};

BRAppMetaService.prototype.getLocaleCookieName = function() {
	return window.$BRJS_LOCALE_COOKIE_NAME
};

function getBundlePath(prefix, bundlePath) {
	if (bundlePath != undefined) {
		/* make sure there are no leading or trailing /s that might mess up the generated path */
		prefix = prefix.replace(/^\/|\/$/g, '');
		if (bundlePath.substring(0, 1) == '/') { 
			bundlePath = bundlePath.substring(1);
		}
		return prefix + "/" + bundlePath
	}
	return prefix;
}


br.implement(BRAppMetaService, AppMetaService);

module.exports = BRAppMetaService;

});


// br/services/AppMetaService
define('br/services/AppMetaService', function(require, exports, module) {
"use strict";

/**
* @module br/services/AppMetaService
*/

var Errors = require('br/Errors');

/**
 * @class
 * @interface
 * @alias module:br/services/AppMetaService
 * 
 * @classdesc
 * A service which provides access to meta data for a BRJS app.
 */
function AppMetaService() {};

/**
* Returns the app version
* @returns The app version
*/
AppMetaService.prototype.getVersion = function() {
	throw new Errors.UnimplementedInterfaceError("AppMetaService.getVersion() has not been implemented.");
};

/**
* Returns the path to content plugins/bundles.
* @param {String} [bundlePath] The path to a bundle to be appended to the returned path
* @returns The path to content plugins/bundles.
*/
AppMetaService.prototype.getVersionedBundlePath = function(bundlePath) {
	throw new Errors.UnimplementedInterfaceError("AppMetaService.getVersionedBundlePath() has not been implemented.");
};

/**
* Returns the locales for the app
* @returns The locales
*/
AppMetaService.prototype.getLocales = function() {
	throw new Errors.UnimplementedInterfaceError("AppMetaService.getLocales() has not been implemented.");
};

/**
* Returns the name of the cookie used to store the locale preference
* @returns The cookie name
*/
AppMetaService.prototype.getLocaleCookieName = function() {
	throw new Errors.UnimplementedInterfaceError("AppMetaService.getLocaleCookieName() has not been implemented.");
};

module.exports = AppMetaService;

});


// br/services/HtmlResourceService
define('br/services/HtmlResourceService', function(require, exports, module) {
var Errors = require('br/Errors');

/**
* @module br/services/HtmlResourceService
*/

/**
 * @class
 * @interface
 * @alias module:br/services/HtmlResourceService
 * 
 * @classdesc
 * A service that provides access to HTML templates.
 */
function HtmlResourceService() {};

/**
 * Access an HTML template by name.
 *
 * @param {String} templateId The identifier of the root element of the template you wish to retrieve.
 */
HtmlResourceService.prototype.getHTMLTemplate = function(templateId) {
	throw new Errors.UnimplementedInterfaceError("br.services.HtmlResourceService.getHTMLTemplate() has not been implemented.");
};

module.exports = HtmlResourceService;

});


// br/core/File
define('br/core/File', function(require, exports, module) {
"use strict";

/**
* @module br/core/File
*/

var Errors = require('br/Errors');

var HTTP_OK = 200;

/**
* Read a contents from a URL
*
* @param {String} url The URL to load contents from
*/
exports.readFileSync = function(url) {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', url, false);
	xhr.send();
	if (xhr.status === HTTP_OK) {
		return xhr.responseText;
	} else {
		throw new Errors.RequestFailedError("Unable to load file " + url + " (status " + xhr.status + ").");
	}
};

});


// br/I18n
define('br/I18n', function(require, exports, module) {
"use strict";

/**
* Returns a {@link module:br/i18n/I18N} object that provides access to i18n functions.
* @module br/i18n
* @exports module:br/i18n/I18N
*/

var Translator = require('br/i18n/Translator');
var I18N = require('br/i18n/I18N');

// TODO: find out why we are sending data to the client in a non-optimal format
function mergeMaps(arrayOfMaps) {
	return arrayOfMaps.reduce(function(accumulator, value) {
		for (var key in value) {
			accumulator[key] = value[key];
		}
		return accumulator;
	}, {});
}

module.exports = I18N.create(new Translator(mergeMaps(window._brjsI18nProperties || [])));

});


// br/i18n/I18N
define('br/i18n/I18N', function(require, exports, module) {
"use strict";

/**
* Provides i18n functions. Accessed via the [br/i18n]{@link module:br/i18n} class.
* @module br/i18n/I18N
*/
var I18N = {};

/** @private */
I18N.create = function(translator) {

	/**
	* Returns the translation for a message using the current locale.
	* @name i18n
	* @method
	* @static
	* @param {String} thingToFormat The translation key.
	* @param {String} [mTemplateArgs] Arguments provided by the template
	* @see {@link br/i18n/Translator:#getMessage}
	*/
	var i18n = function(thingToFormat, mTemplateArgs) {
		return translator.getMessage(thingToFormat, mTemplateArgs);
	};

	/**
	* Returns a number formatted according to the current locale settings.
	* @name number
	* @method
	* @static
	* @param {String} thingToFormat The number to format
	* @see {@link br/i18n/Translator:#formatNumber}
	*/
	i18n.number = function(thingToFormat) {
		return translator.formatNumber(thingToFormat);
	};

	/**
	* Returns a data formatted according to the current locale settings.
	* @name date
	* @method
	* @static
	* @param {String} thingToFormat The data to format
	* @see {@link br/i18n/Translator:#formatDate}
	*/
	i18n.date = function(thingToFormat) {
		return translator.formatDate(thingToFormat);
	};

	/**
	* Returns a time formatted according to the current locale settings.
	* @name time
	* @method
	* @static
	* @param {String} thingToFormat The time to format
	* @see {@link br/i18n/Translator:#formatTime}
	*/
	i18n.time = function(thingToFormat) {
		return translator.formatTime(thingToFormat);
	};

	/**
	* Returns the [Translator]{@link module:br/i18n/Translator} used.
	* @name getTranslator
	* @method
	* @static
	*/
	i18n.getTranslator = function() {
		return translator;
	};

	return i18n;
};

module.exports = I18N;

});


// br/i18n/Translator
define('br/i18n/Translator', function(require, exports, module) {
"use strict";

/**
* @module br/i18n/Translator
*/

var LocalisedNumber = require('./LocalisedNumber');
// LocalisedDate and LocalisedTime use br/i18n which depends on this class,
// so they have to be required where they are used or there would be a circular
// dependency.

var regExp = /\@\{(.*?)\}/m;
var TEST_DATE_FORMAT_SHORT = "d-m-Y";
var TEST_DATE_FORMAT_LONG = "D, d M, Y, h:i:s A";


/**
* @class
* @alias module:br/i18n/Translator
* 
* @classdesc
* <p>The class within the <code>br.I18N</code> package that is responsible
* for translating localization tokens in the form of
* <code>&#64;{key.name}</code> into translated text.</p>
* 
* <p>This class should not be instantiated directly. To access i18n functions
* use the [br/i18n]{@link module:br/i18n} class which returns the
* [br/i18n/I18N]{@link module:br/i18n/I18N} accessor class.
* For example <code>require("br/i18n").i18n("some.i18n.key")</code>.</p>
*/
function Translator(messages) {
	var unproccessedMessages = messages;

	/** @private */
	this.messages = {};

	for (var message in unproccessedMessages) {
		this.messages[message.toLowerCase()] = unproccessedMessages[message];
	}

	/** @private */
	this.localizationPrefs = {};
	/** @private */
	this.testMode = false;
};

/**
* Translate is used to convert raw localization tokens in the form
* <code>&#64;{key.name}</code> into translated text.
*
* <p>By default this method also converts reserved XML characters (<,>,",',&)
* into XML entity references (> into &gt; etc). If you require raw text
* translation without the XML entity reference conversion, pass a type of
* "text" as an argument to this method.</p>
*
* @param {String} sText The string within which to replace localization tokens.
* @param {String} sType The type of text to translate (defaults to "xml", pass
*      "text" for translation without XML entity reference conversion).
* @function
* @this Translator
* @returns A string with localization tokens replaced with the current locale's
*         messages.
*/
Translator.prototype.translate = function(text, type) {
	var message;
	var match = regExp.exec(text);
	type = type || "xml";
	while (match) {
		message = this._getTranslationForKey(match[1]);
		if (type == "xml") {
			message = this.convertXMLEntityChars(message);
		}
		text = text.replace(match[0], message);
		match = regExp.exec(text);
	}
	return text;
};

/**
 * Returns whether the current locale contains a given localization token.
 *
 * <p>Usage: <code>Translator.getTranslator().tokenExists("br.core.field.start.date")</code></p>
 *
 * @param {String} sText The token name
 * @type boolean
 * @returns <code>true</code> if the localization token exists in the current locale's
 *         translation set, otherwise <code>false</code>.
 */
Translator.prototype.tokenExists = function(token) {
	return token.toLowerCase() in this.messages;
};

/**
* Converts XML reserved characters (<,>,",',&) into XML entity references.
*
* @param {String} text The string within which to replace localization tokens.
* @type String
* @returns A string with every XML reserved character replaced with it's
*         corresponding XML entity reference.
*/
Translator.prototype.convertXMLEntityChars = function(text) {
	text = text.replace(/&/g, "&amp;");
	text = text.replace(/</g, "&lt;");
	text = text.replace(/>/g, "&gt;");
	text = text.replace(/\"/g, "&quot;");
	text = text.replace(/\'/g, "&apos;");

	return text;
};

/**
 * The <code>getMessage</code> method replaces a token with it's translation.
 * Additionally, you can supply extra template arguments that the particular
 * translation might need. For example, a given translations may be
 * ${dialog.message.amountWarning} = "you have [template.key.amount] dollars
 * left in account [template.key.account]". You would call
 * <code>br.i18n("dialog.message.amountWarning",
 * {"template.key.amount":"43234", "template.key.account":"testAccount"});</code>
 * to get the fully translated message "you have 43234 dollars left in account
 * testAccount"
 *
 * @param {String} token The token to be translated.
 * @param {Map} templateArgs The *optional* template arguments a translation
 *            may require.
 * @type String
 * @returns A string with message tokens replaced with the current locale's
 *         messages, possibly with additional substitutions for any template
 *         arguments.
 */
Translator.prototype.getMessage = function(token, templateArgs) {
	templateArgs = templateArgs || {};
	var text = this._getTranslationForKeyOrUndefinedIfKeyIsUnknown(token);
	if (text != null) {
		for (var key in templateArgs) {
			var regEx = new RegExp("\\[" + key + "\\]", "g");
			text = text.replace(regEx, templateArgs[key]);
		}
	}
	return formatTranslationResponseIfTranslationWasUnknown(token, text);
};


/**
 * Returns the current date format string for use in displaying the current date format or for
 * other components that require it to format dates.
 *
 * The string is either the default for the locale or if the user has
 * set a preference then that is returned instead.
 *
 * @type String
 * @returns The date format string, e.g. YYYY-mm-dd.
 */
Translator.prototype.getDateFormat = function() {
	return this.localizationPrefs.dateFormat || this._getTranslationForKey("br.i18n.date.format");
};

/**
 * Returns the shorter version of the current date format string for use in displaying the current date format or for
 * other components that require it to format dates.
 *
 * The string is either the default for the locale or if the user has
 * set a preference then that is returned instead.
 *
 * @type String
 * @returns The date format string, e.g. d/m/Y.
 */
Translator.prototype.getShortDateFormat = function() {
	return this.localizationPrefs.shortDateFormat || this._getTranslationForKey("br.i18n.date.format.typed");
};

/**
 * Formats a JavaScript date object according to the locale date format
 * string or another passed in date format string. If no date format string is
 * supplied, this function will default to the date format string referenced by
 * the localization property <code>br.i18n.date.format</code>.
 *
 * <p>Try using the following:</p>
 * <pre>
 * var oTranslator = Translator.getTranslator();
 * oTranslator.formatDate(myDateObject);
 * </pre>
 *
 * <p>Note that this method will also translate any month names
 * (including abbreviated month names) in the date string to the local equivalents.
 * In order for this translation to work correctly, two sets of localization
 * properties need to be set-up.</p>
 *
 * <p>For translation of long month names define localization properties of the
 * form:
 * date.month.january=January<br/>
 *
 * For translation of abbreviated month names define localization properties of
 * the form:
 * date.month.short.january=Jan</p>
 *
 * @param {Date} date A Date object to output as a formatted string.
 * @param {String} dateFormat An optional date format to use. The date formats
 *               supported are the same as those used by the Moment.js Date object.
 *               Refer to the Moment.js API documentation for further details.
 * @type String
 * @returns The formatted date string.
 */
Translator.prototype.formatDate = function(date, dateFormat) {
	if (!dateFormat) {
		dateFormat = this.getDateFormat();
	}

	var localisedDate = new (require('./LocalisedDate'))(date);
	return localisedDate.format(dateFormat);
};

/**
 * Formats the time appropriately for the locale.
 *
 * <p>By specifying a time separator character (':' for example) as the value
 * of the localization property <code>br.i18n.time.format.separator</code>, a time such
 * as '102001' will be formatted as '10:20:01'.</p>
 *
 * <p>Try using the following:</p>
 * <pre>
 * var oTranslator = Translator.getTranslator();
 * oTranslator.formatTime(102001);
 * </pre>
 *
 * @throws {br.Errors} A LocalisedTime object could not be
 *         instantiated from: <code>vTime</code>.
 * @param {Variant} time An integer or string representing the time.
 * @returns A formatted time string.
 *
 * @type String
 */
Translator.prototype.formatTime = function(time) {
	var localisedTime = new (require('./LocalisedTime'))(time);
	return localisedTime.format();
};

/**
 * Formats the number appropriately for the locale.
 *
 * <p>By specifying a number grouping separator character (',' for example) as
 * the value of the localization property <code>br.i18n.number.grouping.separator</code>,
 * a number such as '1000000' will be formatted as '1,000,000'.</p>
 *
 * <p>Try using the following:</p>
 * <pre>
 * var oTranslator = Translator.getTranslator();
 * oTranslator.formatNumber(1000000);
 * </pre>
 *
 * @throws {br.Errors} A LocalisedNumber object could not be
 *         instantiated from: <code>vNumber</code>.
 * @param {Variant} number A number or a string representing the number.
 * @returns A formatted string representation of the number.
 *
 * @type String
 */
Translator.prototype.formatNumber = function(number, thousandsSeparator) {
	var localisedNumber = new LocalisedNumber(number);
	if (!thousandsSeparator) {
		thousandsSeparator = this.localizationPrefs.thousandsSeparator ||
				this._getTranslationForKey("br.i18n.number.grouping.separator");
	}
	var decimalRadixCharacter = this.localizationPrefs.decimalRadixCharacter ||
			this._getTranslationForKey("br.i18n.decimal.radix.character");

	return localisedNumber.format(thousandsSeparator, decimalRadixCharacter);
};

/**
 * Parses the number appropriately for the locale, by removing the thousands seperators.
 *
 * <p>By specifying a number grouping separator character (',' for example) as the value of the localization property
 *  <code>br.i18n.number.grouping.separator</code>, a number such as '1,000,000' will be parsed as '1000000'.</p>
 *
 * <p>Try using the following:</p>
 * <pre>
 * var translator = Translator.getTranslator();
 * oTranslator.parseNumber('1,000,000.00');
 * </pre>
 *
 * @param {String} number A string representing the number.
 * @param {String} thousandsSeparator (optional) A string representing thousands separator.
 *
 * @returns {Number} A parsed number or null if the value can't be parsed.
 */
Translator.prototype.parseNumber = function(number, thousandsSeparator) {
	if (!thousandsSeparator) {
		thousandsSeparator = this.localizationPrefs.thousandsSeparator ||
				this._getTranslationForKey('br.i18n.number.grouping.separator');
	}

	var decimalPlaceCharacter = this.localizationPrefs.decimalRadixCharacter ||
			this._getTranslationForKey("br.i18n.decimal.radix.character");

	thousandsSeparator = thousandsSeparator.replace(/[-[\]*+?.,\\^$|#\s]/g, "\\$&");
	var regEx = new RegExp(thousandsSeparator, "g");
	number = number.replace(regEx, '');
	number = number.replace(decimalPlaceCharacter, '.');

	var numberLength = number.length;

	if (number[numberLength - 1] === decimalPlaceCharacter) {
		number = number.substr(0, numberLength - 1);
	}

	if (isNaN(number)) {
		return null;
	}

	return Number(number);
};

/**
 * Strings non numeric characters from the specified string.
 *
 * @param {String} value the string to strip the non numeric values from.
 *
 * @returns The string without numeric characters
 * @type String
 */
Translator.prototype.stripNonNumericCharacters = function(value) {
	var length = value.length;
	var joiner = [];
	var isDecimalPointFound = false;
	var decimalPlaceCharacter = this.localizationPrefs.decimalRadixCharacter || this._getTranslationForKey("br.i18n.decimal.radix.character");

	for (var i = 0; i < length; i++) {
		var thisChar = value.charAt(i);
		if (isNaN(thisChar) === true) {
			if (thisChar === decimalPlaceCharacter) {
				if (isDecimalPointFound == false) {
					joiner.push(".");
					isDecimalPointFound = true;
				}
			}
		} else {
			joiner.push(thisChar);
		}
	}
	return joiner.join("");
};

/**
 * Sets localization preferences for the <code>Translator</code>.
 *
 * @param {Map} localizationPrefs A map containing the localization preferences.
 */
Translator.prototype.setLocalizationPreferences = function(localizationPrefs) {
	this.localizationPrefs = localizationPrefs;
};


/**
* @private
*/
Translator.prototype._setMessages = function(messages) {
	this.messages = messages;
};

/** @private */
Translator.prototype._getTranslationForKey = function(token) {
	var text = this._getTranslationForKeyOrUndefinedIfKeyIsUnknown(token);
	return formatTranslationResponseIfTranslationWasUnknown(token, text);
};

/** @private */
Translator.prototype._getTranslationForKeyOrUndefinedIfKeyIsUnknown = function(token) {
	token = token.toLowerCase();
	if (this.testMode === true) {
		if (token == "br.i18n.date.format") {
			return TEST_DATE_FORMAT_SHORT;
		} else if (token == "br.i18n.date.format.long") {
			return TEST_DATE_FORMAT_LONG;
		}
		return ".";
	}
	return this.messages[token];
};

function formatTranslationResponseIfTranslationWasUnknown(key, text) {
	return (text) ? text : "??? " + key + " ???";
}

module.exports = Translator;

});


// br/i18n/LocalisedTime
define('br/i18n/LocalisedTime', function(require, exports, module) {
"use strict";

/**
* @module br/i18n/LocalisedTime
*/

var Errors = require('br/Errors');
var i18n = require('br/I18n');

/**
 * @private
 * @class
 * @alias module:br/i18n/LocalisedTime
 */
function LocalisedTime(time) {
	if (!isValidTime(time)) {
		var exceptionMessage = "A LocalisedTime object could not be instantiated from: " + time;
		throw new Errors.InvalidParametersError(exceptionMessage);
	}
	this.time = time;
};

LocalisedTime.prototype.format = function() {
	var timeString = String(this.time);
	var timeSeparatorToken = i18n("br.i18n.time.format.separator");
	var replacementPattern = "$1" + timeSeparatorToken;
	var regExp = /(\d{2})/g;
	var formattedTime = timeString.replace(regExp, replacementPattern);

	var lastChar = formattedTime.length - 1;
	if (formattedTime.charAt(lastChar) === timeSeparatorToken) {
		return formattedTime.substring(0, lastChar);
	}
	return formattedTime;
};

function isValidTime(vTime) {
	if (vTime && isCorrectLength(vTime)) {
		return (!isNaN(vTime));
	}
	return false;
}

function isCorrectLength(vTime) {
	var nLength = String(vTime).length;
	return (nLength > 0 && nLength < 7) ? true : false;
}

module.exports = LocalisedTime;

});


// br/i18n/LocalisedDate
define('br/i18n/LocalisedDate', function(require, exports, module) {
"use strict";

/**
* @module br/i18n/LocalisedDate
*/

var moment = require('momentjs');
var i18n = require('br/I18n');

/**
 * @private
 * @class
 * @alias module:br/i18n/LocalisedDate
 */
function LocalisedDate(date) {
	this.date = date;
}

LocalisedDate.prototype.format = function(dateFormat) {
	var formattedDate = (dateFormat === "U") ? moment(this.date).unix() : moment(this.date).format(dateFormat);
	if (this._containsAmPm(dateFormat)) {
		// format a date containing only the am or pm string
		var amPmString = moment(this.date).format("a");
		var localeAmPmString = i18n("br.i18n.date." + amPmString);
		formattedDate = formattedDate.replace(amPmString, localeAmPmString);
	}

	if (this._containsMonthName(dateFormat)) {
		var monthName = this._getMonthName();
		var monthToken = "br.i18n.date.month." + monthName.toLowerCase();
		if (this._containsAbbreviatedMonthName(dateFormat)) {
			monthToken = "br.i18n.date.month.short." + monthName.toLowerCase();
			monthName = this._getAbbreviatedMonthName();
		}
		formattedDate = formattedDate.replace(monthName, i18n(monthToken));
	}

	if (this._containsDayName(dateFormat)) {
		var dayName = this._getDayName();
		var dayToken = "br.i18n.date.day." + dayName.toLowerCase();
		if (this._containsAbbreviatedDayName(dateFormat)) {
			dayToken = "br.i18n.date.day.short." + dayName.toLowerCase();
			dayName = this._getAbbreviatedDayName();
		}
		formattedDate = formattedDate.replace(dayName, i18n(dayToken));
	}

	return formattedDate;
};

LocalisedDate.prototype._containsMonthName = function(dateFormat) {
	return (dateFormat.indexOf('MMM') !== -1) ? true : false;
};

LocalisedDate.prototype._containsAbbreviatedMonthName = function(dateFormat) {
	return this._containsMonthName(dateFormat) && !this._containsLongMonthName(dateFormat);
};

LocalisedDate.prototype._containsLongMonthName = function(dateFormat) {
	return (dateFormat.indexOf('MMMM') !== -1) ? true : false;
};

LocalisedDate.prototype._getAbbreviatedMonthName = function() {
	return moment(this.date).format("MMM");
};

LocalisedDate.prototype._getMonthName = function() {
	return moment(this.date).format("MMMM");
};

LocalisedDate.prototype._containsDayName = function(dateFormat) {
	return (dateFormat.indexOf('ddd') !== -1) ? true : false;
};

LocalisedDate.prototype._containsAbbreviatedDayName = function(dateFormat) {
	return this._containsDayName(dateFormat) && !this._containsLongDayName(dateFormat);
};

LocalisedDate.prototype._containsLongDayName = function(dateFormat) {
	return (dateFormat.indexOf('dddd') !== -1) ? true : false;
};

LocalisedDate.prototype._getAbbreviatedDayName = function() {
	return moment(this.date).format("ddd");
};

LocalisedDate.prototype._getDayName = function() {
	return moment(this.date).format("dddd");
};

LocalisedDate.prototype._containsAmPm = function(dateFormat) {
	return (dateFormat.indexOf('a') !== -1) ? true : false;
};

module.exports = LocalisedDate;

});


// br/i18n/LocalisedNumber
define('br/i18n/LocalisedNumber', function(require, exports, module) {
"use strict";

/**
* @module br/i18n/LocalisedNumber
*/

var Errors = require('br/Errors');

/**
 * @private
 * @class
 * @alias module:br/i18n/LocalisedNumber
 */
function LocalisedNumber(number) {
	if (!isValidNumber(number)) {
		var exceptionMessage = "A LocalisedNumber object could not be instantiated from: " + number + ".";
		throw new Errors.InvalidParametersError(exceptionMessage);
	}
	this.number = number;
}

LocalisedNumber.prototype.format = function(thousandsSeparator, decimalRadixCharacter) {
	var numberToFormat = String(this.number);
	var unsignedNumber = getUnsignedNumber(numberToFormat);
	if (unsignedNumber === null) { return ""; }
	var formattedNumber = addSeparator(unsignedNumber, thousandsSeparator);
	numberToFormat = numberToFormat.replace(".", decimalRadixCharacter);
	return numberToFormat.replace(unsignedNumber, formattedNumber);
};


function addSeparator(number, thousandsSeparator) {
	var length = number.length - 3;
	for (var i = length; i > 0; i -= 3) {
		number = number.substr(0, i) + thousandsSeparator + number.substr(i);
	}
	return number;
}

function getUnsignedNumber(number) {
	var match = number.match(/\d+/);
	return match != null ? String(match) : null;
}

function isValidType(number) {
	var numberType = typeof(number);
	return (numberType === "string" || numberType === "number");
}

function isValidNumber(number) {
	return isValidType(number) && number !== "" && !isNaN(number);
};

module.exports = LocalisedNumber;

});


// br/component/Component
define('br/component/Component', function(require, exports, module) {
"use strict";

/**
* @module br/component/Component
*/

var Errors = require('br/Errors');

/**
* @class
* @interface
* @alias module:br/component/Component
* 
* @classdesc
* This interface must be implemented by a presentation-level class. A
* presentation-level class represents something that occupies physical
* space on the page, such as the content of a panel or a
* dialog box.
* 
* <p> Each implementation of a Component represents a different <b>Component type</b>,
* for example a Grid or a Trade Panel.
* 
* <p>A component receives a Frame, on which it can set its content element and attach
* event listeners.
*
* <p>Components that can have their state saved should also implement br.component.Serializable.
*/
function Component() {}

/**
 * @param {module:br/component/Frame} frame A frame provided by the layout manager that this component can
 * attach its visual DOM elements into.  Will be called only once.
 */
Component.prototype.setDisplayFrame = function(frame) {
	throw new Errors.UnimplementedAbstractMethodError("Component.setDisplayFrame: Your component needs to implement setDisplayFrame.");
};

module.exports = Component;

});


// brjstodo/input/InputViewModel
define('brjstodo/input/InputViewModel', function(require, exports, module) {
"use strict";

var ENTER_KEY_CODE = 13;

var ServiceRegistry = require( 'br/ServiceRegistry' );
var ko = require( 'ko' );

function InputViewModel() {
  this.todoText = ko.observable('');
  this._todoService = ServiceRegistry.getService( 'todomvc.storage' );
}

InputViewModel.prototype.keyPressed = function( data, event ) {
  if( event.keyCode === ENTER_KEY_CODE ) {
    var todoTextValue = this.todoText().trim();

    var todoItem = { title: todoTextValue };
    this._todoService.addTodo( todoItem );

    this.todoText( '' );
  }

  return true;
};

module.exports = InputViewModel;

});


// brjstodo/items/ItemsViewModel
define('brjstodo/items/ItemsViewModel', function(require, exports, module) {
"use strict";

var ServiceRegistry = require( 'br/ServiceRegistry' );
var TodoViewModel = require( './TodoViewModel' );
var ko = require( 'ko' );

var ENTER_KEY_CODE = 13;
var ESCAPE_KEY_CODE = 27;

/**
 * The View Model representing the UI for a list of todo items.
 */
function ItemsViewModel() {
  this._todoService = ServiceRegistry.getService( 'todomvc.storage' );
  this._todoService.on( 'todo-added', this._todoAdded, this );
  this._todoService.on( 'todo-removed', this._todoRemoved, this );

  var todos = this._todoService.getTodos();
  var todoVMs = [];
  todos.forEach( function( todo ) {
    todoVMs.push( new TodoViewModel( todo ) );
  } );

  this.todos = ko.observableArray( todoVMs );

  this.listVisible = new ko.computed(function() {
      return this.todos().length;
    }, this);

  // count of all completed todos
  this.completedCount = ko.computed(function () {
      var count = this.todos().filter(function (todo) {
        return todo.completed();
      }).length;

      return count;
    }, this );

  // count of todos that are not complete
  this.remainingCount = ko.computed(function () {
      var remaining = ( this.todos().length - this.completedCount() );
      return remaining;
    }, this );

  this.allCompleted = ko.computed({
      //always return true/false based on the done flag of all todos
      read: function () {
        return !this.remainingCount();
      },
      // set all todos to the written value (true/false)
      write: function (newValue) {
        this.todos().forEach(function (todo) {
          // set even if value is the same, as subscribers are not notified in that case
          todo.completed(newValue);
        });
      }
    }, this);

}

/** @private */
ItemsViewModel.prototype._todoAdded = function( added ) {
  var todoViewModel = new TodoViewModel( added );
  this.todos.push( todoViewModel );
};

/** @private */
ItemsViewModel.prototype._todoRemoved = function( removed ) {
  this.todos().forEach( function( todoVM ) {
    if( todoVM.getTodo() === removed ) {
      this.todos.remove( todoVM );
    }
  }, this );
};

/** @private */
ItemsViewModel.prototype._clearCompleted = function() {
  this.todos.remove( function( todo ) {
    return todo.completed();
  } );
};

/**
 * Called from the view to remove a todo item.
 */
ItemsViewModel.prototype.remove = function( item, event ) {
  // remove view model
  this.todos.remove( item );
  // remove domain model
  this._todoService.removeTodo( item.getTodo() );
};

/**
 * Called from view
 */
ItemsViewModel.prototype.editItem = function( item ) {
  item.editing( true );
  item.previousTitle = item.title();
};

/**
 * Called from view.
 * Note: keypress isn't triggered for ESC key.
 */
ItemsViewModel.prototype.keyPressed = function( item, event ) {
  if( event.keyCode === ENTER_KEY_CODE ) {
    this.saveEdit( item );
  }

  return true;
};

/**
 * Called from view.
 */
ItemsViewModel.prototype.saveEdit = function( item ) {
  item.editing(false);

  var title = item.title();
  var trimmedTitle = title.trim();

  // Observable value changes are not triggered if they're consisting of whitespaces only
  // Therefore we've to compare untrimmed version with a trimmed one to chech whether anything changed
  // And if yes, we've to set the new value manually
  if ( title !== trimmedTitle ) {
    item.title(trimmedTitle);
  }

  if ( !trimmedTitle ) {
    this.remove( item );
  }
};

/**
 * Called from view on keydown.
 */
ItemsViewModel.prototype.cancelEditing = function( item, event ) {
  if( event.keyCode === ESCAPE_KEY_CODE ) {
    item.editing( false );
    item.title( item.previousTitle );
  }

  return true;
};

/**
 * Called from view.
 */
ItemsViewModel.prototype.stopEditing = function( item ) {
  item.editing( false );
};

module.exports = ItemsViewModel;

});


// brjstodo/items/TodoViewModel
define('brjstodo/items/TodoViewModel', function(require, exports, module) {
"use strict";

var ko = require( 'ko' );
var ServiceRegistry = require( 'br/ServiceRegistry' );

function TodoViewModel( todo ) {
  this._todo = todo;
  this._todoService = ServiceRegistry.getService( 'todomvc.storage' );

  this.title = ko.observable( todo.title );
  this.completed = ko.observable( todo.completed || false );

  this.editing = ko.observable( false );
  // Used to store old title during editing
  this.previousTitle = null;

  this.title.subscribe( function( updatedVal ) {
    this._todo.title = updatedVal;
    this._todoService.updateTodo( this._todo );
  }, this );

  this.completed.subscribe( function( updatedVal ) {
    this._todo.completed = updatedVal;
    this._todoService.updateTodo( this._todo );
  }, this );
}

TodoViewModel.prototype.getTodo = function() {
  return this._todo;
};

module.exports = TodoViewModel;

});


// todomvc/LocalStorageService
define('todomvc/LocalStorageService', function(require, exports, module) {
var br = require( 'br/Core' );
var Emitr = require( 'emitr' );
var TodoService = require( './TodoService' );

var TODO_ITEMS_ID = 'brjs-todo-items';

function LocalStorageService() {
  var items = localStorage.getItem( TODO_ITEMS_ID );
  this._items = ( items ? JSON.parse( items ) : [] );
}
br.extend( LocalStorageService, Emitr );
br.implement( LocalStorageService, TodoService );

LocalStorageService.prototype.addTodo = function( item ) {
  this._items.push( item );
  this._sync();
  this.trigger( 'todo-added', item );
};

LocalStorageService.prototype.updateTodo = function( item ) {
  this._items.forEach( function( existingItem, index ) {
    if ( item === existingItem ) {
      // since check is by reference there's no need for the following line
      // this._items[ i ] = item;
      this._sync();

      this.trigger( 'todo-updated', item );

      return false;
    }
  }, this );
};

LocalStorageService.prototype.removeTodo = function( item ) {
  this._items.forEach( function( existingItem, index ) {
    if ( item === existingItem ) {
      this._items.splice( item, 1 );
      this._sync();

      this.trigger( 'todo-removed', item );

      return false;
    }
  }, this );
};

LocalStorageService.prototype.getTodos = function() {
  return this._items;
};

LocalStorageService.prototype._sync = function() {
  localStorage.setItem( TODO_ITEMS_ID, JSON.stringify( this._items ) );
};

module.exports = LocalStorageService;

});


// todomvc/TodoService
define('todomvc/TodoService', function(require, exports, module) {
/**
 * @interface
 */
function TodoService() {
}

TodoService.prototype.addTodo = function( todo ) {};

TodoService.prototype.updateTodo = function( todo ) {};

TodoService.prototype.removeTodo = function( todo ) {};

TodoService.prototype.getTodos = function() {};

/**
 * Events:
 *
 * 'todo-added' - when a new todo item is added
 * 'todo-removed' - when a todo item is removed
 * `todo-updated` - when an existing todo item is updated
 */

module.exports = TodoService;

});


// brjstodo/filter/FilterViewModel
define('brjstodo/filter/FilterViewModel', function(require, exports, module) {
"use strict";

var ServiceRegistry = require( 'br/ServiceRegistry' );
var ko = require( 'ko' );

/**
 *
 */
function FilterViewModel() {
  this._todoService = ServiceRegistry.getService( 'todomvc.storage' );
  this._todoService.on( 'todo-added', this._sync, this );
  this._todoService.on( 'todo-updated', this._sync, this );
  this._todoService.on( 'todo-removed', this._sync, this );

  var todos = this._todoService.getTodos();

  this.todoCount = ko.observable( todos.length );
  this.itemsLabel = ko.computed( function() {
    return ( this.todoCount() > 1? 'items' : 'item' );
  }, this );
  this.completedCount = ko.observable( 0 );

  this.visible = new ko.computed(function() {
      return ( this.todoCount() > 0 ||
               this.completedCount() > 0 );
    }, this);
}

/**
 * Synchronise the UI state with the contents of the service.
 */
FilterViewModel.prototype._sync = function() {
  var todos = this._todoService.getTodos();
  this.todoCount( todos.length );

  var completed = 0;
  todos.forEach( function( todo ) {
    if( todo.completed ) {
      ++completed;
    }
  }, this );
  this.completedCount( completed );
};

/**
 * Called from the View to indicate completed items should be cleared.
 */
FilterViewModel.prototype.clearCompleted = function() {
  var todos = this._todoService.getTodos();
  var toRemove = [];
  todos.forEach( function( todo ) {
    if( todo.completed ) {
      toRemove.push( todo );
    }
  }, this );

  toRemove.forEach( function( todo ) {
    this._todoService.removeTodo( todo );
  }, this );
};

module.exports = FilterViewModel;

});




require('br/AliasRegistry').setAliasData({'br.event-hub':{'class':require('br/EventHub'),'className':'br.EventHub'},'br.app-meta-service':{'class':require('br/services/appmeta/BRAppMetaService'),'className':'br.services.appmeta.BRAppMetaService'},'br.html-service':{'class':require('br/services/html/BRHtmlResourceService'),'className':'br.services.html.BRHtmlResourceService'}});


