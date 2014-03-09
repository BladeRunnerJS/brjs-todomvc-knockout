/**
 * @interface
 */
function TodosService() {
}

TodosService.prototype.addTodo = function() {};

TodosService.prototype.removeTodo = function() {};

TodosService.prototype.getTodos = function() {};

TodoService.prototype.addTodosListener = function( listener ) {};

module.exports = TodosService;
