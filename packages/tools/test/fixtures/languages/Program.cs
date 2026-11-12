var app = WebApplication.Create(args);
app.MapGet("/orders/{id}", (int id) => Results.Ok(id));
var group = app.MapGroup("/api");
group.MapPost("/orders", Create);
app.Run();

public class OrdersController
{
    [Authorize, HttpGet("x")]
    public IActionResult X() => Ok();
}
