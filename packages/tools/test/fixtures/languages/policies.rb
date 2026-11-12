module Policies
  class PoliciesController < ApplicationController
    def show
      @policy = Policy.find(params[:id])
    end
    def self.build; end
  end
end
