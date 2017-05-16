var chai = require("chai");
var request = require("request");
var should = require("chai").should();
var message = require("../index.js")

describe('Sending message or not', function() {
    it('should check description for non-date content', function() {
       var description = message.description("2017-05-16 12:46 +03:00:"); 
       description.should.to.equal("YYYY-MM-DD HH:mm Z:");
    });
});
