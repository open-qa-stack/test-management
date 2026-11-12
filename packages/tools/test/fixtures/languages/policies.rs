pub struct Policy { id: String }
pub enum Kind { Health }
pub trait Repository { fn find(&self, id: &str) -> Option<Policy>; }
impl Repository for Store { fn find(&self, id: &str) -> Option<Policy> { None } }
pub fn premium(p: &Policy) -> u32 { 0 }
