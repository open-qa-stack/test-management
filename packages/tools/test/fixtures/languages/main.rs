#[get("/orders/{id}")]
async fn get_order() -> String { String::new() }
impl Display for Order { fn fmt(&self) {} }
impl Order { fn new() -> Self { Order {} } }
trait Repo { fn find(&self); }
