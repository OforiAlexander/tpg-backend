// src/utils/bindMethods.js
module.exports = function bindMethods(instance, methodNames) {
    methodNames.forEach(name => {
      instance[name] = instance[name].bind(instance);
    });
  };
  