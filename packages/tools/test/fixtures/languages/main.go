package main
func main() {
	http.HandleFunc("GET /orders", list)
	r := gin.Default()
	r.POST("/orders", create)
}
