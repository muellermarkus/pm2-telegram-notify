'use strict';

var pm2 = require('pm2');
var pmx = require('pmx');
var request = require('request');


// Get the configuration from PM2
var conf = pmx.initModule();

// initialize buffer and queue_max opts
// buffer seconds can be between 1 and 5
conf.buffer_seconds = (conf.buffer_seconds > 0 && conf.buffer_seconds < 5) ? conf.buffer_seconds : 2;

// queue max can be between 10 and 100
conf.queue_max = (conf.queue_max > 9 && conf.queue_max <= 100) ? conf.queue_max : 10;

// create the message queue
var messages = [];

// create the suppressed object for sending suppression messages
var suppressed = {
    isSuppressed: false,
    date: new Date().getTime()
};


// Function to send event to Telegram
function sendTelegram(message) {

    var name = message.name;
    var event = message.event;
    var description = message.description;
    var timestamp = message.timestamp;
    

    // If a Telegram URL is not set, we do not want to continue and nofify the user that it needs to be set. URL must be formatted as ' https://api.telegram.org/bot<TOKEN>/sendMessage'
    if (!conf.telegram_url) return console.error("There is no telegram URL set, please set the telegram URL: 'pm2 set pm2-telegram-notify:telegram_url https://telegram_url'");
   
    console.log(messages.length) 
 
    // checks for event name and timestamps
  if ((messages.length != 0) && (event =='log' && messages[0].event == 'error')  && (timestamp <= messages[0].timestamp)) {
      
    //Check for description's content
    if (description.length > 30) {
    //Text for sending to telegram, must be <string>
     var length = 2000;
     var cutDesc = description.substring(0, length);
     var cutPrevDesc = messages[0].description.substring(0, length);
     var text  = (name + ' - ' + '*' + messages[0].event + '*' +  ' - ' + cutDesc + '\n ' + '*' + cutPrevDesc + '*');
     
        
      // Options for the post request
     var options = {
          method: 'post',
          headers: {'content-type' : 'application/x-www-form-urlencoded'},
          body: "chat_id="+conf.chat_id+"&text="+text + '&parse_mode=markdown',
          json: true,
          url: conf.telegram_url
     };
        

     // Finally, make the post request to the Telegram
     request(options, function(err, res, body) {
         if (err) return console.error(err);
         console.log(body)
     });
    }
  } 
}

// Function to get the next buffer of messages (buffer length = 1s)
function bufferMessage() {
    var nextMessage = messages.shift();

    if (!conf.buffer) { return nextMessage; }

    nextMessage.buffer = [nextMessage.description];

    // continue shifting elements off the queue while they are the same event and timestamp so they can be buffered together into a single request
    while (messages.length
        && (messages[0].timestamp >= nextMessage.timestamp && messages[0].timestamp < (nextMessage.timestamp  + conf.buffer_seconds))
        && messages[0].event != nextMessage.event) {

        // append description to our buffer and shift the message off the queue and discard it
        nextMessage.buffer.push(messages[0].description);
        messages.shift();

    }

    // join the buffer with newlines
    nextMessage.description = nextMessage.buffer.join("\n");

    // delete the buffer from memory
    delete nextMessage.buffer;

    return nextMessage;
}

// Function to process the message queue
function processQueue() {

    // If we have a message in the message queue, removed it from the queue and send it to telegram
    if (messages.length > 0) {
        sendTelegram(bufferMessage());
    }

    // If there are over conf.queue_max messages in the queue, send the suppression message if it has not been sent and delete all the messages in the queue after this amount (default: 100)
    if (messages.length > conf.queue_max) {
        if (!suppressed.isSuppressed) {
            suppressed.isSuppressed = true;
            suppressed.date = new Date().getTime();
            sendTelegram({
                name: 'pm2-telegram-notify',
                event: 'suppressed',
                description: 'Messages are being suppressed due to rate limiting.'
            });
        }
        messages.splice(conf.queue_max, messages.length);
    }

    // If the suppression message has been sent over 1 minute ago, we need to reset it back to false
    if (suppressed.isSuppressed && suppressed.date < (new Date().getTime() - 60000)) {
            suppressed.isSuppressed = false;
    }

    // Wait 10 seconds and then process the next message in the queue
     setTimeout(function() {
         processQueue();
     }, 10000);
}

// Start listening on the PM2 BUS
pm2.launchBus(function(err, bus) {

    
    // Listen for process logs
    if (conf.log) {
        bus.on('log:out', function(data) {
            if (data.process.name !== 'pm2-telegram-notify') {
                messages.push({
                    name: data.process.name,
                    event: 'log',
                    description: data.data,
                    timestamp: Math.floor(Date.now() / 100000),
                });
            }
        });
    }

    // Listen for process errors
    if (conf.error) {
        bus.on('log:err', function(data) {
            if (data.process.name !== 'pm2-telegram-notify') {
                messages.push({
                    name: data.process.name,
                    event: 'error',
                    description: data.data,
                    timestamp: Math.floor(Date.now() / 99999),
                });
            }
        });
    }

    // Listen for PM2 kill
    if (conf.kill) {
        bus.on('pm2:kill', function(data) {
            messages.push({
                name: 'PM2',
                event: 'kill',
                description: data.msg,
                timestamp: Math.floor(Date.now() / 100000),
            });
        });
    }

    // Listen for process exceptions
    if (conf.exception) {
        bus.on('process:exception', function(data) {
            if (data.process.name !== 'pm2-telegram-notify') {
                messages.push({
                    name: data.process.name,
                    event: 'exception',
                    description: JSON.stringify(data.data),
                    timestamp: Math.floor(Date.now() / 100000),
                });
            }
        });
    }

    // Listen for PM2 events
    bus.on('process:event', function(data) {
        if (conf[data.event]) {
            if (data.process.name !== 'pm2-telegram-notify') {
                messages.push({
                    name: data.process.name,
                    event: data.event,
                    description: 'The following event has occured on the PM2 process ' + data.process.name + ': ' + data.event,
                    timestamp: Math.floor(Date.now() / 100000),
                });
            }
        }
    });

    // Start the message processing
    processQueue();

});
