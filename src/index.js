const axios = require("axios") 

const UPLOAD_INTERVAL =  5 * 1000;

axios.interceptors.response.use(
  function (res) {
    return { status: res.status, text: res.data };
  },
  function (error) {
    if (!error.response) {
      return Promise.reject("Server error");
    }
    return Promise.reject(
      error.response.status +
      ": " +
      (error.response.data.error
        ? error.response.data.error
        : error.response.data)
    );
  }
);

const URLS = {
  uploadDataset: "/api/deviceapi/uploadDataset",
  initDatasetIncrement: "/ds/api/dataset/init/",
  addDatasetIncrement: "/ds/api/dataset/append/"
};

/**
 * Uploads a whole dataset to a specific project
 * @param {string} url - The url of the backend server
 * @param {string} key - The Device-Api-Key
 * @param {object} dataset - The dataset to upload
 * @returns A Promise indicating success or failure
 */
async function sendDataset(url, key, dataset) {
  const res = await axios.post(url + URLS.uploadDataset, {
    key: key,
    payload: dataset,
  });
  return res.text.message;
}

/**
 *
 * @param {string} url - The url of the backend server
 * @param {string} key - The Device-Api-Key
 * @param {boolean} useDeviceTime - True if you want to use timestamps generated by the server
 * @returns Function to upload single datapoints to one dataset inside a specific project
 */
async function datasetCollector(
  url,
  key,
  name,
  useDeviceTime,
  timeSeries,
  metaData,
  datasetLabel
) {
  var labeling = undefined;
  if (datasetLabel) {
    labeling = {"labelingName": datasetLabel.split("_")[0], "labelName": datasetLabel.split("_")[1]}
  }

  const data = await axios.post(url + URLS.initDatasetIncrement + key, {
    name: name,
    metaData: metaData,
    timeSeries: timeSeries,
    labeling: labeling
  });
  if (!data || !data.text || !data.text.id) {
    throw new Error("Could not generate datasetCollector");
  }
  const datasetKey = data.text.id;

  var uploadComplete = false;
  var dataStore = { data: [] };
  var lastChecked = Date.now()
  var error = undefined;
  var timeSeries = timeSeries;

  /**
   * Uploads a vlaue for a specific timestamp to a datasets timeSeries with name sensorName
   * @param {string} name - The name of the timeSeries to upload the value to
   * @param {number} value - The datapoint to upload
   * @param {number} time - The timestamp assigned to the datapoint
   * @returns A Promise indicating success or failure of upload
   */
  function addDataPoint(time, name, value) {

    if (!timeSeries.includes(name)) {
      throw Error("invalid time-series name")
    }

    if (error) {
      throw new Error(error);
    }
    if (typeof value !== "number") {
      throw new Error("Datapoint is not a number");
    }
    if (!useDeviceTime && typeof time !== "number") {
      throw new Error("Provide a valid timestamp");
    }

    if (useDeviceTime) {
      time = new Date().getTime();
    }

    value = Math.round(value * 100) / 100;

    if (dataStore.data.every((elm) => elm.name !== name)) {
      dataStore.data.push({
        name: name,
        data: [[time, value]],
      });
    } else {
      const idx = dataStore.data.findIndex(
        (elm) => elm.name === name
      );
      dataStore.data[idx].data.push([time, value]);

      if (dataStore.data[idx].start > time) {
        dataStore.data[idx].start = time;
      }
      if (dataStore.data[idx].end < time) {
        dataStore.data[idx].end = time;
      }
    }

    if (Date.now() - lastChecked > UPLOAD_INTERVAL) {
      upload();
      lastChecked = Date.now();
      dataStore = { data: [] };
    }
  }

  async function upload(datasetLabel) {
    const tmp_datastore = JSON.parse(JSON.stringify(dataStore));
    const response = await axios.post(url + URLS.addDatasetIncrement + key + "/" + datasetKey, {"data": tmp_datastore.data, "labeling": labeling});
  }

  /**
   * Synchronizes the server with the data when you have added all data
   */
  async function onComplete() {
    if (uploadComplete) {
      throw new Error("Dataset is already uploaded");
    }
    await upload(datasetLabel);
    if (error) {
      throw new Error(error);
    }
    uploadComplete = true;
  }

  if (useDeviceTime) {
    return {
      addDataPoint: (sensorName, value) =>
        addDataPoint(undefined, sensorName, value),
      onComplete: onComplete,
    };
  } else {
    return {
      addDataPoint: (time, sensorName, value) =>
        addDataPoint(time, sensorName, value),
      onComplete: onComplete,
    };
  }
}

const edgeML = {
  datasetCollector: datasetCollector,
  sendDataset: sendDataset

};

export default edgeML;