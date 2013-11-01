;( function() {

  var App = function() {

    // pass in the HTML template identifier and View Model
    var PresenterComponent = br.presenter.component.PresenterComponent;

    // todo input Blade
    var inputModel = new brjstodo.todo.todoinput.ExamplePresentationModel();
    this.inputComponent = new PresenterComponent( 'brjstodo.todo.todoinput.view-template', inputModel );

    // todo items Blade
    var itemsModel = new brjstodo.todo.todoitems.ExamplePresentationModel();        
    this.itemsComponent = new PresenterComponent( 'brjstodo.todo.todoitems.view-template', itemsModel );

    var inputFrame = new br.component.SimpleFrame( this.inputComponent );
    document.getElementById( 'header' ).appendChild( inputFrame.getElement() );

    var itemsFrame = new br.component.SimpleFrame( this.itemsComponent );
    document.getElementById( 'main' ).appendChild( itemsFrame.getElement() );
  };

  brjstodo.App = App;

} )();
    