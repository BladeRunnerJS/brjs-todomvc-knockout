caplin.thirdparty('caplin-br');
    
( function() {
  
  var br = require( 'br' );
  var ServiceRegistry = require( 'br/ServiceRegistry' );

  function ExamplePresentationModel() {
    var DisplayField = br.presenter.node.DisplayField;
    var NodeList = br.presenter.node.NodeList;
    this.items = new NodeList( [ new DisplayField( 'foo' ), new DisplayField( 'bar' ) ] );

    // get the event hub
    this.eventHub = ServiceRegistry.getService( 'br.demo-event-hub' );

    // register to recieve events
    this.eventHub.channel( 'todo-list' ).on( 'todo-added', this._todoAdded, this );
  };

  br.extend( ExamplePresentationModel, br.presenter.PresentationModel );

  ExamplePresentationModel.prototype._todoAdded = function( added ) {
    var DisplayField = br.presenter.node.DisplayField;

    // create a new field for the new item
    var newItem = new DisplayField( added.text );

    // get the existing items
    var nodes = this.items.getPresentationNodesArray();

    // append the new item to the array
    nodes.push( newItem );

    // update the View Model which triggers a UI update
    this.items.updateList( nodes );
  };

  brjstodo.todo.todoitems.ExamplePresentationModel = ExamplePresentationModel;
} )();