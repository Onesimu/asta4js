"use strict";

var _lib_observe = require("../lib/observe");

var util = require("./util");
var config = require("./config");
var constant = require("./constant")
var Snippet = require("./snippet")

var BindContext = require("./bind-context")
var ValueMonitor = require("./value-monitor")

var optionUtil = require("./form-option")

var getInputType=function(jq){
  var inputType;
  var tagName = jq.prop("tagName");
  if(tagName === "INPUT"){
    inputType = jq.attr("type");
    if(inputType){
      inputType = inputType.toLowerCase();
    }
  }else if(tagName === "SELECT"){
    inputType = "select";
  }
  return inputType;
}

var _form = function (meta) {
  var formDef = meta._form;
  var propertyPath = meta._target_path;
  
  if (typeof formDef === "string") {
    formDef = {
      _name : formDef
    };
  }
  
  if(!formDef._name){
    var lastDotIndex = propertyPath.lastIndexOf(".");
    formDef._name = propertyPath.substr(lastDotIndex+1);
  }

  if (!meta._selector) {
    meta._selector = "[name=" + formDef._name + "]";
  }

  if (!meta._render) {
    meta._render = function (target, newValue, oldValue, bindContext) {
      var inputType = getInputType(target);
      if(inputType === "select"){
        //move diverge value option at first
        target.find("[aj-diverge-value]").remove();
        target.val(newValue);
        var domValue = target.val();
        if (domValue === null) { //which means there is no corresponding option
          var op = $("<option aj-diverge-value>").val(newValue).text(newValue);
          target.append(op);
          target.val(newValue);
        }
        /*
        var optionBindingHub = optionUtil.getOptionBindingHub(bindContext, meta._meta_trace_id);
        if(optionBindingHub.notifyValueChanged){
          optionBindingHub.notifyValueChanged();
        }
        */
      }else if(inputType === "checkbox" || inputType === "radio"){
        if(formDef._single_check){
          if(newValue){
            target.prop("checked", true);
          }else{
            target.prop("checked", false);
          }
        }else{
          var va = util.regulateArray(newValue);
          if(inputType === "radio" && va.length > 1){
            throw "There are over than one candidate value for radio:" + va;
          }
          var unmatchedValue = [];
          //there must be "aj-placeholder-id"
          var placeHolderId = target.attr("aj-placeholder-id");
          
          if(!placeHolderId){//option bind has not been called yet or static option
            return;
          }
          
          var snippet = bindContext._snippet;
          
          //remove the auto generated diverge elements
          snippet.find("[aj-diverge-value=" + placeHolderId + "]").remove();
          
          //find out all the existing options
          var ops = snippet.find("[aj-generated=" + placeHolderId + "]");
          util.findWithRoot(ops, "input[type="+type+"]").prop("checked", false);
          va.forEach(function(v){
            if(v === null || v === undefined){
              v = "";
            }
            var foundInput = util.findWithRoot(ops, "input[value='"+v+"']");
            if(foundInput.length === 0){
              if(v){
                unmatchedValue.push(v);
              }
            }else{
              foundInput.prop("checked", true);
            }
          });
          if(unmatchedValue.length > 0){
            var insertPoint = snippet.find("#" + placeHolderId);
            unmatchedValue.forEach(function(v){
              var uid = util.createUID();
              var clone = target.clone().attr("id", uid).val(v).prop("checked", true);
              var label = $("<label>").attr("for",uid).text(v);
              
              var diverge = $("<span>").attr("aj-diverge-value", placeHolderId);
              diverge.append(clone).append(label);
              
              insertPoint.after(diverge);
              insertPoint = diverge;
            });
          }
        }
      }else{
        target.val(newValue);
      } //end inputType
      
      //save the current value to target as data attribute
      util.getDataRef(target, "aj-form-binding-ref").value = newValue;
    } // end _render = function...
  } // end !meta._render

  if (!meta._register_dom_change) {
    var changeEvents = new Array();

    var defaultChangeEvent = formDef._default_change_event;
    if (defaultChangeEvent === undefined) {
      changeEvents.push("blur");
    } else if (defaultChangeEvent) {
      changeEvents.push(defaultChangeEvent);
    }

    var extraChangeEvents = formDef._extra_change_events;
    extraChangeEvents = util.regulateArray(extraChangeEvents);
    Array.prototype.push.apply(changeEvents, extraChangeEvents);
    

    if (changeEvents.length > 0) {
      meta._register_dom_change = function (target, changeHandler, bindContext) {
        var inputType = getInputType(target);
        if(inputType && !formDef._single_check){
          var optionBindingHub = optionUtil.getOptionBindingHub(bindContext, meta._meta_trace_id);
          optionBindingHub.inputType = inputType;
        }

        if(inputType === "checkbox" || inputType === "radio"){
          if(formDef._single_check){
            target.bind(changeEvents.join(" "), function () {
              var v = $(this).prop("checked");
              changeHandler(v, bindContext);
            }); 
          }else{
            var observer = new _lib_observe.PathObserver(ref, "value");
            observer.open(function(newValue, oldValue){
              changeHandler(newValue, bindContext);
            });
            snippet._discardHooks.push(function(){
              observer.close();
            });
          }
        }else{
          target.bind(changeEvents.join(" "), function () {
            var v = $(this).val();
            changeHandler(v, bindContext);
          }); 
        }
      }// end meta._register_assign
    };// end changeEvents.length > 0
  }// end !meta._register_assign
  
  if (formDef._option) {
    var varPath = formDef._option._var_path;
    var varRef = formDef._option._var_ref;
    var varRefSearchKey = formDef._option._var_ref_search_key;
    delete formDef._option._var_path;
    delete formDef._option._var_ref;
    var optionMeta;
    meta._post_binding.push(function (bindContext) {
      if(!varPath){
        var scope = bindContext.valueMonitor.scope;
        varPath = util.determineRefPath(scope, varRef, varRefSearchKey);
      }
      
      var optionBindingHub = optionUtil.getOptionBindingHub(bindContext, meta._meta_trace_id);//must have
      if(!optionMeta){
        optionMeta = optionUtil.rewriteOptionMeta(formDef._option, optionBindingHub.inputType);
      }
      
      optionBindingHub.notifyOptionChange=function(){
        bindContext.forceSyncFromObserveTarget(meta._meta_trace_id);
      };

      var optionMonitor = new ValueMonitor(scope, varPath);
      var snippet = bindContext.snippet;
      
      var optionContext = new BindContext({
        valueMonitor: optionMonitor,
        snippet: snippet,
        optionBindingHub: optionBindingHub,
        inputTargetBindContext: bindContext,
      });
      bindContext.addDiscardHook(function(){
        optionContext.discard();
      });
      optionContext.bind(optionMeta);
    });
  }
}

config.meta.rewritterMap["_form"] = {
  priority : constant.metaRewritterPriority["_form"],
  fn : _form
};

