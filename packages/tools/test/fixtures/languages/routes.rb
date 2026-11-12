Rails.application.routes.draw do
  resources :orders
  get 'photos/:id', to: 'photos#show'
end
