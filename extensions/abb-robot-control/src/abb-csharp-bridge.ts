/**
 * abb-csharp-bridge.ts
 * C# Bridge for ABB Robot Control via PC SDK
 * Uses edge-js to call C# code that communicates with actual ABB robot controllers
 */

import * as edge from "edge-js";
import { EventEmitter } from "node:events";
import path from "node:path";

/**
 * ABB C# Bridge - Communicates with actual ABB robots via PC SDK
 */
export class ABBCSharpBridge extends EventEmitter {
  private connected: boolean = false;
  private systemName: string = "";
  private executeConnect: any;
  private executeDisconnect: any;
  private executeGetStatus: any;
  private executeGetJointPositions: any;
  private executeMoveToJoints: any;
  private executeExecuteRapid: any;
  private executeSetMotors: any;

  constructor() {
    super();
    this.initializeBridge();
  }

  /**
   * Initialize C# bridge functions
   */
  private initializeBridge() {
    try {
      const dllPath = path.join(__dirname, "ABBBridge.dll");
      
      this.executeConnect = edge.func({
        assemblyFile: dllPath,
        typeName: "ABBBridge",
        methodName: "Connect"
      });
      
      this.executeDisconnect = edge.func({
        assemblyFile: dllPath,
        typeName: "ABBBridge",
        methodName: "Disconnect"
      });
      
      this.executeGetStatus = edge.func({
        assemblyFile: dllPath,
        typeName: "ABBBridge",
        methodName: "GetStatus"
      });
      
      this.executeGetJointPositions = edge.func({
        assemblyFile: dllPath,
        typeName: "ABBBridge",
        methodName: "GetJointPositions"
      });
      
      this.executeMoveToJoints = edge.func({
        assemblyFile: dllPath,
        typeName: "ABBBridge",
        methodName: "MoveToJoints"
      });
      
      this.executeExecuteRapid = edge.func({
        assemblyFile: dllPath,
        typeName: "ABBBridge",
        methodName: "ExecuteRapidProgram"
      });
      
      this.executeSetMotors = edge.func({
        assemblyFile: dllPath,
        typeName: "ABBBridge",
        methodName: "SetMotors"
      });
    } catch (err) {
      console.warn("Warning: C# Bridge DLL not found. Using mock implementation.");
    }
  }

  /**
   * Connect to ABB controller
   */
  async connect(host: string, port: number = 7000): Promise<any> {
    try {
      if (this.executeConnect) {
        const result = await this.executeConnect({ host, port });
        if (result.success) {
          this.connected = true;
          this.systemName = result.systemName;
          this.emit("connected", result);
        }
        return result;
      } else {
        throw new Error("C# Bridge not initialized");
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Disconnect from controller
   */
  async disconnect(): Promise<any> {
    try {
      if (this.executeDisconnect) {
        const result = await this.executeDisconnect({});
        if (result.success) {
          this.connected = false;
          this.emit("disconnected");
        }
        return result;
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get controller status
   */
  async getStatus(): Promise<any> {
    try {
      if (this.executeGetStatus) {
        return await this.executeGetStatus({});
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get current joint positions
   */
  async getJointPositions(): Promise<number[]> {
    try {
      if (this.executeGetJointPositions) {
        const result = await this.executeGetJointPositions({});
        return result.joints || [];
      }
    } catch (error) {
      console.error("Error getting joint positions:", error);
      return [];
    }
  }

  /**
   * Move to joint positions
   */
  async moveToJoints(joints: number[], speed: number = 100, zone: string = "fine"): Promise<any> {
    try {
      if (this.executeMoveToJoints) {
        return await this.executeMoveToJoints({ joints, speed, zone });
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Execute RAPID program
   */
  async executeRapidProgram(code: string, moduleName: string = "MainModule"): Promise<any> {
    try {
      if (this.executeExecuteRapid) {
        return await this.executeExecuteRapid({ code, moduleName });
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Set motors on/off
   */
  async setMotors(state: "ON" | "OFF"): Promise<any> {
    try {
      if (this.executeSetMotors) {
        return await this.executeSetMotors({ state });
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get system name
   */
  getSystemName(): string {
    return this.systemName;
  }
}

export function createCSharpBridge(): ABBCSharpBridge {
  return new ABBCSharpBridge();
}
