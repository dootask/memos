#!/usr/bin/env python3
"""
AI智能配置脚本 - 为memos项目配置/apps/memos子路径
读取modifications.yaml配置文件，使用AI智能理解并修改代码
"""

import os
import sys
import yaml
import requests

def read_file(filepath):
    """读取文件内容"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"读取文件失败 {filepath}: {e}")
        return None

def write_file(filepath, content):
    """写入文件内容"""
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    except Exception as e:
        print(f"写入文件失败 {filepath}: {e}")
        return False

def apply_ai_modification(file_path, instruction, description):
    """使用AI来智能修改文件"""
    original_content = read_file(f"app/{file_path}")
    if not original_content:
        return False
    
    # 检查API密钥
    openai_key = os.getenv('OPENAI_API_KEY')
    
    if not openai_key:
        print("错误: 未找到AI API密钥！请设置 OPENAI_API_KEY 环境变量")
        return False
    
    # 构建AI提示词，使用中文让AI更好理解
    prompt = f"""
你是一个专业的代码修改助手。请根据以下指令修改代码：

修改任务：{description}
具体指令：{instruction}

原始代码：
{original_content}

请只返回修改后的完整代码，不要包含任何解释或markdown格式：
"""
    
    try:
        print(f"正在使用AI处理: {file_path}...")
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {openai_key}'},
            json={
                'model': 'gpt-4.1',
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.1
            },
            timeout=60
        )
        
        if response.status_code == 200:
            modified_content = response.json()['choices'][0]['message']['content']
            # 清理可能的markdown格式
            modified_content = modified_content.replace('```typescript', '').replace('```go', '').replace('```', '').strip()
            
            if write_file(f"app/{file_path}", modified_content):
                print(f"AI成功修改: {file_path}")
                return True
        else:
            print(f"AI API请求失败: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"AI修改过程出错: {e}")
        return False

def main():
    """主函数：执行配置应用流程"""
    print("开始使用AI应用 /apps/memos 配置...")
    
    # 检查app目录是否存在
    if not os.path.exists("app"):
        print("错误: 找不到app目录！请确保已经克隆了memos项目")
        sys.exit(1)
    
    # 读取配置文件
    try:
        with open('configure_subpath.yaml', 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
    except Exception as e:
        print(f"读取配置文件失败: {e}")
        sys.exit(1)
    
    success_count = 0
    total_count = len(config['modifications'])
    
    # 逐个处理配置项
    for modification in config['modifications']:
        file_path = modification['file']
        instruction = modification['instruction']
        description = modification.get('description', '')
        
        print(f"\n处理文件: {file_path}")
        print(f"任务描述: {description}")
        
        if apply_ai_modification(file_path, instruction, description):
            success_count += 1
        else:
            print(f"修改失败: {file_path}")
            sys.exit(1)  # 任何修改失败都直接退出
    
    print(f"\n配置应用完成: {success_count}/{total_count} 个文件修改成功")
    print("✅ 所有配置都已成功应用!")

if __name__ == "__main__":
    main()
