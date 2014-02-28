var ServiceRegistry = require( 'br/ServiceRegistry' );
var InputViewModel = require( 'brjstodo/todo/input/InputViewModel' );

var fakeEventHub;
var fakeChannel;

var InputViewModelTest = TestCase('InputViewModelTest');

InputViewModelTest.prototype.setUp = function() {

  fakeChannel = {
    trigger: function( eventName, data ) {
      // store event name and data
      this.eventName = eventName;
      this.data = data;
    }
  };

  fakeEventHub = {
    channel: function( channelName ) {
      // store the name of the channel
      this.channelName = channelName;
      return fakeChannel;
    }
  };

  // ensure there isn't already an event-hub registered
  ServiceRegistry.deregisterService( 'br.event-hub' );

  // Register the fake event hub
  ServiceRegistry.registerService( 'br.event-hub', fakeEventHub );
};

InputViewModelTest.prototype.testTodoTextFieldIsInitialized = function() {
  var todoInputBlade = new InputViewModel();

  assertEquals( '', todoInputBlade.todoText() );
};

InputViewModelTest.prototype.testEnterKeyPressedTriggersEventOnEventHub = function() {
  // Initialize
  var testTodoTitle = 'write some code and test it';
  var todoInputBlade = new InputViewModel();
  todoInputBlade.todoText( testTodoTitle );

  // Execute test
  todoInputBlade.keyPressed( null, { keyCode: 13 } );

  // Verify
  assertEquals( 'todo-list', fakeEventHub.channelName );
  assertEquals( 'todo-added', fakeChannel.eventName );
  assertEquals( testTodoTitle, fakeChannel.data.title );
};