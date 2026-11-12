<?php
Route::get('/orders', [OrderController::class, 'index']);
Route::resource('photos', PhotoController::class);
class C {
    #[IsGranted('ROLE_USER'), Route('/z')]
    public function z() {}
}
