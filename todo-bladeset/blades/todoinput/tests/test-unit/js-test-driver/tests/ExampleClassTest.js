var ServiceRegistry = require( 'br/ServiceRegistry' );
var ExamplePresentationModel = require( 'brjstodo/todo/todoinput/ExamplePresentationModel' );

var fakeEventHub;
var fakeChannel;

var ExampleClassTest = TestCase('ExampleClassTest');

ExampleClassTest.prototype.setUp = function() {

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

ExampleClassTest.prototype.testTodoTextFieldIsInitialized = function() {
  var todoInputBlade = new ExamplePresentationModel();

  assertEquals( '', todoInputBlade.todoText.value.getValue() );
};

ExampleClassTest.prototype.testEnterKeyPressedTriggersEventOnEventHub = function() {
  // Initialize
  var testTodoTextValue = 'write some code and test it';
  var todoInputBlade = new ExamplePresentationModel();
  todoInputBlade.todoText.value.setValue( testTodoTextValue );

  // Execute test
  todoInputBlade.keyPressed( null, { keyCode: 13 } );

  // Verify
  assertEquals( 'todo-list', fakeEventHub.channelName );
  assertEquals( 'todo-added', fakeChannel.eventName );
  assertEquals( testTodoTextValue, fakeChannel.data.text );
};